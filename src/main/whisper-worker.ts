import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, renameSync, statfsSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { parentPort } from 'node:worker_threads';
import type { BackendId } from './capabilities';
import { modelBytes, modelCacheFolder, selectDetectedLanguage, type ModelSpec } from './models';

type Transcriber = ((
  audio: Float32Array,
  options?: Record<string, unknown>,
) => Promise<{ text: string }>) & {
  model: any;
  processor: any;
  dispose(): Promise<void>;
};

type BackendPlan = { id: BackendId; label: string; gpu: boolean };
type ModelPlan = Pick<ModelSpec, 'key' | 'label' | 'quantization' | 'approxBytes' | 'mlx' | 'onnx'>;

type PrepareRequest = {
  cacheDir: string;
  allowDownload: boolean;
  runnerPath?: string;
  backends: BackendPlan[];
  model: ModelPlan;
  threads: number;
};

type WorkerRequest =
  | ({ id: number; type: 'prepare' } & PrepareRequest)
  | { id: number; type: 'transcribe'; samples: Float32Array; language?: string }
  | { id: number; type: 'dispose' };

type MlxReply = { id: number; result?: any; error?: string };

let transcriber: Transcriber | undefined;
let preparePromise: Promise<void> | undefined;
let activeBackend: BackendPlan | undefined;
let mlxRunner: ChildProcessWithoutNullStreams | undefined;
let mlxRequestId = 1;
const mlxPending = new Map<number, { resolve: (result: any) => void; reject: (error: Error) => void }>();

const PREPARE_ATTEMPTS = 3;
const PREPARE_BACKOFF_MS = 1_500;

if (!parentPort) throw new Error('Whisper worker requires a parent port');

parentPort.on('message', (request: WorkerRequest) => {
  void handleRequest(request);
});

async function handleRequest(request: WorkerRequest): Promise<void> {
  try {
    let result: unknown;
    if (request.type === 'prepare') {
      await prepare(request);
    } else if (request.type === 'transcribe') {
      if (!request.samples) throw new Error('Missing audio samples');
      result = await transcribe(request.samples, request.language);
    } else {
      await transcriber?.dispose();
      transcriber = undefined;
      activeBackend = undefined;
      await teardownBackend('mlx');
    }
    parentPort!.postMessage({ kind: 'response', id: request.id, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    postStatus({ phase: 'error', message }, true);
    parentPort!.postMessage({ kind: 'response', id: request.id, error: message });
  }
}

function prepare(request: PrepareRequest): Promise<void> {
  if (activeBackend) return Promise.resolve();
  preparePromise ??= withRetries(
    () => load(request),
    PREPARE_ATTEMPTS,
    PREPARE_BACKOFF_MS,
    (_attempt, message) => postStatus({ message }, true),
  ).finally(() => {
    preparePromise = undefined;
  });
  return preparePromise;
}

/** Walk the ranked backend chain; the first one that loads wins. */
async function load(request: PrepareRequest): Promise<void> {
  mkdirSync(request.cacheDir, { recursive: true });
  const model = request.model;
  const total = modelBytes(model, request.backends[0]?.id === 'mlx' ? 'mlx' : 'onnx');
  postStatus({
    phase: 'loading',
    progress: 1,
    modelName: model.label,
    quantization: model.quantization,
    downloadedBytes: total,
    totalBytes: total,
    message: 'Loading the local model…',
  }, true);

  let lastError: unknown;
  for (const backend of request.backends) {
    try {
      if (backend.id === 'mlx') await loadMlx(backend, request);
      else await loadOnnx(backend, request);
      activeBackend = backend;
      writeReadyMarker(request, backend);
      postReady(backend, request.model);
      return;
    } catch (error) {
      lastError = error;
      process.stderr.write(`[wiss] ${backend.label} failed: ${String(error)}\n`);
      postStatus({
        phase: 'loading',
        backend: backend.label,
        message: `${backend.label} unavailable — falling back…`,
      }, true);
      await teardownBackend(backend.id);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('No usable speech backend on this machine');
}

async function loadMlx(backend: BackendPlan, request: PrepareRequest): Promise<void> {
  if (!request.runnerPath || !existsSync(request.runnerPath)) {
    throw new Error('The Apple MLX runner is not bundled with this build');
  }
  const modelPath = join(request.cacheDir, modelCacheFolder(request.model, 'mlx'));
  mkdirSync(modelPath, { recursive: true });
  await ensureMlxModel(modelPath, request);
  postStatus({ phase: 'loading', backend: backend.label, message: 'Starting Apple MLX…' }, true);
  await startMlxRunner(request.runnerPath!);
  await requestMlx('prepare', { modelPath });
}

async function loadOnnx(backend: BackendPlan, request: PrepareRequest): Promise<void> {
  const transformers = await import('@huggingface/transformers');
  const modelPath = join(request.cacheDir, modelCacheFolder(request.model, 'onnx'));
  mkdirSync(modelPath, { recursive: true });
  postStatus({ phase: 'loading', backend: backend.label, message: `Starting ${backend.label}…` }, true);

  const sessionOptions: Record<string, unknown> =
    backend.id === 'cpu'
      ? {
          executionMode: 'sequential',
          intraOpNumThreads: request.threads,
          interOpNumThreads: 1,
          graphOptimizationLevel: 'all',
        }
      : backend.id === 'coreml'
        ? { executionProviders: [{ name: 'coreml', coreMlFlags: 0x010 }], graphOptimizationLevel: 'all' }
        : { graphOptimizationLevel: 'all' };

  transcriber = (await transformers.pipeline('automatic-speech-recognition', request.model.onnx.repo, {
    revision: request.model.onnx.revision,
    dtype: request.model.onnx.dtype as 'q4',
    device: backend.id as 'coreml' | 'webgpu' | 'dml' | 'cpu',
    cache_dir: modelPath,
    local_files_only: !request.allowDownload,
    progress_callback: handleProgress,
    session_options: sessionOptions,
  })) as unknown as Transcriber;
}

async function teardownBackend(id: BackendId): Promise<void> {
  transcriber = undefined;
  if (id === 'mlx' && mlxRunner) {
    await requestMlx('dispose').catch(() => undefined);
    mlxRunner.kill();
    mlxRunner = undefined;
  }
}

function writeReadyMarker(request: PrepareRequest, backend: BackendPlan): void {
  const folder = modelCacheFolder(request.model, backend.id === 'mlx' ? 'mlx' : 'onnx');
  writeFileSync(
    join(request.cacheDir, folder, 'ready.json'),
    `${JSON.stringify({
      model: backend.id === 'mlx' ? request.model.mlx.repo : request.model.onnx.repo,
      revision: backend.id === 'mlx' ? request.model.mlx.revision : request.model.onnx.revision,
      modelKey: request.model.key,
      backend: backend.label,
      readyAt: new Date().toISOString(),
    }, null, 2)}\n`,
  );
}

function postReady(backend: BackendPlan, model: ModelPlan): void {
  const total = modelBytes(model, backend.id === 'mlx' ? 'mlx' : 'onnx');
  postStatus({
    phase: 'ready',
    progress: 1,
    downloadedBytes: total,
    totalBytes: total,
    backend: backend.label,
    modelName: model.label,
    quantization: model.quantization,
    message: 'Ready for private local dictation',
  }, true);
}

async function transcribe(samples: Float32Array, language?: string): Promise<{ text: string; language: string }> {
  if (mlxRunner) {
    const bytes = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
    return requestMlx('transcribe', { audio: bytes.toString('base64'), language });
  }
  if (!transcriber) throw new Error('Whisper is not ready');
  const detectedLanguage = language ?? (await detectWhisperLanguage(transcriber, samples));
  const result = await transcriber(samples, {
    language: detectedLanguage,
    task: 'transcribe',
    return_timestamps: false,
    temperature: 0,
    do_sample: false,
    num_beams: 1,
    max_new_tokens: Math.min(448, Math.max(64, Math.ceil(samples.length / 16_000) * 16)),
  });
  return { text: result.text, language: detectedLanguage };
}

/** Resumable ranged GET of the pinned weights.npz; size-checked before use. */
async function ensureMlxModel(modelPath: string, request: PrepareRequest): Promise<void> {
  const { repo, revision, bytes } = request.model.mlx;
  const base = `https://huggingface.co/${repo}/resolve/${revision}`;
  const weightsPath = join(modelPath, 'weights.npz');
  const configPath = join(modelPath, 'config.json');
  const complete = existsSync(weightsPath) && statSync(weightsPath).size === bytes;
  if (complete && existsSync(configPath)) return;
  if (!request.allowDownload) throw new Error(`${request.model.label} has not been downloaded yet`);
  if (!existsSync(configPath)) {
    const response = await fetch(`${base}/config.json?download=true`);
    if (!response.ok) throw new Error(`Unable to download model configuration (${response.status})`);
    writeFileSync(configPath, await response.text());
  }
  if (!complete) {
    assertFreeSpace(modelPath, bytes, request.model.label);
    await downloadWeights(base, weightsPath, bytes, request);
  }
}

/**
 * Checked here rather than in the host, because only this function knows
 * whether a download is actually about to happen — a fully cached model needs
 * no free space at all.
 *
 * ponytail: 2 GB headroom covers the ONNX graph-optimisation scratch for the
 * GPU backends. Raise it if a tier ever needs more; never lower it below the
 * weights, or a download will fill the volume and leave a corrupt .partial.
 */
function assertFreeSpace(modelPath: string, bytes: number, label: string): void {
  const stats = statfsSync(modelPath);
  const free = stats.bavail * stats.bsize;
  const required = bytes + 2_000_000_000;
  if (free < required) {
    throw new Error(`${label} needs about ${Math.ceil(required / 1e9)} GB of free disk space to download.`);
  }
}

async function downloadWeights(base: string, destination: string, expectedBytes: number, request: PrepareRequest): Promise<void> {
  const partial = `${destination}.partial`;
  let downloaded = existsSync(partial) ? statSync(partial).size : 0;
  const response = await fetch(`${base}/weights.npz?download=true`, {
    headers: downloaded > 0 ? { Range: `bytes=${downloaded}-` } : undefined,
  });
  if (!(response.ok || response.status === 206) || !response.body) {
    throw new Error(`Unable to download ${request.model.label} (${response.status})`);
  }
  const resumed = response.status === 206 && downloaded > 0;
  if (!resumed) downloaded = 0;
  const output = createWriteStream(partial, { flags: resumed ? 'a' : 'w' });
  let lastUpdate = 0;
  try {
    for await (const chunk of response.body) {
      const bytes = Buffer.from(chunk);
      if (!output.write(bytes)) await once(output, 'drain');
      downloaded += bytes.length;
      const now = Date.now();
      if (now - lastUpdate >= 100) {
        lastUpdate = now;
        postStatus({
          phase: 'downloading',
          progress: Math.min(1, downloaded / expectedBytes),
          downloadedBytes: downloaded,
          totalBytes: expectedBytes,
          backend: 'Apple MLX',
          message: 'Installing Apple GPU voice model…',
        });
      }
    }
  } finally {
    output.end();
    await once(output, 'finish');
  }
  const finalSize = statSync(partial).size;
  if (finalSize !== expectedBytes) {
    throw new Error(`Model download is incomplete (${finalSize} of ${expectedBytes} bytes)`);
  }
  renameSync(partial, destination);
}

function handleProgress(event: { status: string; progress?: number; loaded?: number; total?: number }): void {
  if (event.status === 'progress_total') {
    postStatus({
      phase: 'downloading',
      progress: Math.max(0, Math.min(1, (event.progress ?? 0) / 100)),
      downloadedBytes: event.loaded ?? 0,
      totalBytes: event.total ?? 0,
      message: 'Installing local voice model…',
    });
  } else if (event.status === 'ready') {
    postStatus({ phase: 'loading', progress: 1, message: 'Preparing Whisper…' }, true);
  }
}

function postStatus(patch: Record<string, unknown>, force = false): void {
  parentPort!.postMessage({ kind: 'status', patch, force });
}

async function startMlxRunner(runnerPath: string): Promise<void> {
  if (mlxRunner) return;
  const child = spawn(runnerPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  mlxRunner = child;
  child.stderr.on('data', (chunk) => process.stderr.write(`[MLX] ${chunk}`));
  createInterface({ input: child.stdout }).on('line', (line) => {
    let reply: MlxReply;
    try {
      reply = JSON.parse(line) as MlxReply;
    } catch (error) {
      process.stderr.write(`[MLX] Invalid runner response: ${String(error)}\n`);
      return;
    }
    const pending = mlxPending.get(reply.id);
    if (!pending) return;
    mlxPending.delete(reply.id);
    if (reply.error) pending.reject(new Error(reply.error));
    else pending.resolve(reply.result);
  });
  child.on('exit', (code) => {
    const error = new Error(`Apple MLX runner exited with code ${code}`);
    // Reject in-flight work rather than leaving the dictation hanging.
    for (const pending of mlxPending.values()) pending.reject(error);
    mlxPending.clear();
    if (mlxRunner === child) mlxRunner = undefined;
  });
  child.on('error', rejectPending);
}

function rejectPending(error: Error): void {
  for (const pending of mlxPending.values()) pending.reject(error);
  mlxPending.clear();
  mlxRunner = undefined;
}

function requestMlx(command: string, payload: Record<string, unknown> = {}): Promise<any> {
  if (!mlxRunner) return Promise.reject(new Error('Apple MLX runner is unavailable'));
  const id = mlxRequestId++;
  return new Promise((resolve, reject) => {
    mlxPending.set(id, { resolve, reject });
    try {
      mlxRunner!.stdin.write(`${JSON.stringify({ id, command, ...payload })}\n`);
    } catch (error) {
      mlxPending.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

async function detectWhisperLanguage(model: Transcriber, samples: Float32Array): Promise<string> {
  const transformers = await import('@huggingface/transformers');
  const inputs = await model.processor(samples);
  const config = model.model.generation_config;
  const decoderInputIds = new transformers.Tensor(
    'int64',
    BigInt64Array.of(BigInt(config.decoder_start_token_id)),
    [1, 1],
  );
  let outputs: Record<string, unknown> | undefined;
  try {
    const modelOutputs = await model.model.forward({ input_features: inputs.input_features, decoder_input_ids: decoderInputIds });
    outputs = modelOutputs;
    const logits = modelOutputs.logits as { data: ArrayLike<number>; dims: number[] };
    return selectDetectedLanguage(logits.data, logits.dims.at(-1)!, config.lang_to_id);
  } finally {
    decoderInputIds.dispose();
    disposeTensors(outputs);
    disposeTensors(inputs);
  }
}

function disposeTensors(value: unknown, seen = new Set<unknown>()): void {
  if (!value || (typeof value !== 'object' && typeof value !== 'function') || seen.has(value)) return;
  seen.add(value);
  if ('dispose' in value && typeof value.dispose === 'function') {
    void value.dispose();
    return;
  }
  for (const child of Object.values(value as Record<string, unknown>)) disposeTensors(child, seen);
}

async function withRetries<T>(
  operation: () => Promise<T>,
  attempts: number,
  backoffMs: number,
  onRetry: (attempt: number, message: string) => void,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      const message = error instanceof Error ? error.message : String(error);
      onRetry(attempt, `Retry ${attempt + 1}/${attempts} in ${Math.round(backoffMs * attempt)}ms — ${message}`);
      await new Promise((resolve) => setTimeout(resolve, backoffMs * attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}