import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { planRuntime } from '../src/main/capabilities';
import { WhisperModelManager } from '../src/main/whisper-model';

const cacheDir = process.env.WISS_TEST_MODEL_CACHE;
const wavDir = process.env.WISS_TEST_WAV_DIR;
const mlxRunner = process.env.WISS_TEST_MLX_RUNNER;
const integration = cacheDir && wavDir ? describe : describe.skip;

integration('Whisper multilingual local inference', () => {
  let workDir: string;
  let manager: WhisperModelManager;

  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'wiss-whisper-'));
    manager = new WhisperModelManager(
      cacheDir!,
      () => undefined,
      planRuntime(Boolean(mlxRunner)),
      mlxRunner,
      join(process.cwd(), 'out/main/whisper-worker.js'),
    );
    // The opt-in integration fixture may contain validated weights without the
    // application's ready marker; prepare() will reuse them without redownloading.
    await manager.prepare(true);
  }, 180_000);

  afterAll(async () => {
    await manager?.dispose();
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  test.each([
    ['en.wav', 'en'],
    ['de.wav', 'de'],
    ['es.wav', 'es'],
    ['fr.wav', 'fr'],
  ])('auto-detects and transcribes %s', async (file, expectedLanguage) => {
    const rawPath = join(workDir, `${basename(file, '.wav')}.f32le`);
    execFileSync('ffmpeg', [
      '-loglevel', 'error',
      '-y',
      '-i', join(wavDir!, file),
      '-ac', '1',
      '-ar', '16000',
      '-f', 'f32le',
      rawPath,
    ]);
    const bytes = readFileSync(rawPath);
    const samples = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / Float32Array.BYTES_PER_ELEMENT);
    const result = await manager.transcribe(samples);
    console.log(`${file}: [${result.language}] ${result.text.trim()}`);
    expect(result.language).toBe(expectedLanguage);
    expect(result.text.trim().length).toBeGreaterThan(3);
  }, 180_000);
});
