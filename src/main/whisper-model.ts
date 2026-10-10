import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { RuntimePlan } from './capabilities';
import type { ModelStatus } from '../shared';

export interface WhisperResult {
  text: string;
  language: string;
  words?: string[];
  starts?: number[];
}

type WorkerRequest = {
  id: number;
  type: 'prepare' | 'transcribe' | 'dispose';
  samples?: Float32Array;
  language?: string;
  words?: boolean;
};

type WorkerMessage =
  | { kind: 'status'; patch: Partial<ModelStatus>; force?: boolean }
  | { kind: 'response'; id: number; result?: unknown; error?: string };

type PendingRequest = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
};

export class WhisperModelManager {
  private worker?: Worker;
  private preparePromise?: Promise<void>;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private lastNotificationAt = 0;
  private currentStatus: ModelStatus;
  private isReady = false;
  private disposing = false;

  constructor(
    readonly cacheDir: string,
    private readonly onStatus: (status: ModelStatus) => void,
    readonly plan: RuntimePlan,
    private readonly runnerPath?: string,
    private readonly workerPath = join(import.meta.dirname, 'whisper-worker.js'),
  ) {
    mkdirSync(cacheDir, { recursive: true });
    this.currentStatus = {
      phase: 'missing',
      progress: 0,
      downloadedBytes: 0,
      totalBytes: plan.model.approxBytes,
      modelName: plan.model.label,
      quantization: plan.model.quantization,
    };
  }

  get status(): ModelStatus {
    return { ...this.currentStatus };
  }

  get ready(): boolean {
    return this.isReady;
  }

  prepare(allowDownload = true): Promise<void> {
    if (this.isReady) return Promise.resolve();
    this.preparePromise ??= this.load(allowDownload).finally(() => {
      this.preparePromise = undefined;
    });
    return this.preparePromise;
  }

  async transcribe(samples: Float32Array, language?: string, words = false): Promise<WhisperResult> {
    await this.prepare(false);
    const result = await this.request('transcribe', { samples, language, words }, [samples.buffer as ArrayBuffer]);
    return result as WhisperResult;
  }

  async dispose(): Promise<void> {
    const worker = this.worker;
    if (!worker) return;
    this.disposing = true;
    try {
      await this.request('dispose');
    } catch {
      // The worker may already be shutting down.
    } finally {
      await worker.terminate();
      this.worker = undefined;
      this.isReady = false;
      this.disposing = false;
    }
  }

  shutdownNow(): void {
    this.disposing = true;
    const error = new Error('Whisper is shutting down');
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    void this.worker?.terminate();
    this.worker = undefined;
    this.isReady = false;
  }

  private async load(allowDownload: boolean): Promise<void> {
    await this.request('prepare', {
      cacheDir: this.cacheDir,
      allowDownload,
      runnerPath: this.runnerPath,
      backends: this.plan.backends.map((backend) => ({ ...backend })),
      model: this.plan.model,
      threads: this.plan.inferenceThreads,
    } as unknown as WorkerRequest & Record<string, unknown>);
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(this.workerPath, { name: 'wiss-whisper' });
    worker.on('message', (message: WorkerMessage) => this.handleWorkerMessage(message));
    worker.on('error', (error) => this.handleWorkerFailure(error));
    worker.on('exit', (code) => {
      if (!this.disposing && code !== 0) this.handleWorkerFailure(new Error(`Whisper worker exited with code ${code}`));
    });
    this.worker = worker;
    return worker;
  }

  private request(
    type: WorkerRequest['type'],
    payload: Omit<WorkerRequest, 'id' | 'type'> = {},
    transfer: ArrayBuffer[] = [],
  ): Promise<unknown> {
    const id = this.nextRequestId++;
    const worker = this.ensureWorker();
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ id, type, ...payload } satisfies WorkerRequest, transfer);
    });
  }

  private handleWorkerMessage(message: WorkerMessage): void {
    if (message.kind === 'status') {
      this.update(message.patch, message.force);
      if (message.patch.phase === 'ready') this.isReady = true;
      if (message.patch.phase === 'error') this.isReady = false;
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error) pending.reject(new Error(message.error));
    else pending.resolve(message.result);
  }

  private handleWorkerFailure(error: Error): void {
    this.isReady = false;
    this.worker = undefined;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.update({ phase: 'error', message: error.message }, true);
  }

  private update(patch: Partial<ModelStatus>, force = false): void {
    this.currentStatus = { ...this.currentStatus, ...patch };
    const now = Date.now();
    if (!force && now - this.lastNotificationAt < 100) return;
    this.lastNotificationAt = now;
    this.onStatus({ ...this.currentStatus });
  }
}