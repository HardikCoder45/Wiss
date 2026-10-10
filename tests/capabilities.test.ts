import { afterEach, describe, expect, it } from 'vitest';
import { backendChain, modelFor, type SystemProfile } from '../src/main/capabilities';
import { MODELS } from '../src/main/models';

const profile = (overrides: Partial<SystemProfile> = {}): SystemProfile => ({
  platform: 'darwin',
  arch: 'arm64',
  cpuModel: 'Apple M4',
  cores: 10,
  totalRamBytes: 16_000_000_000,
  appleSilicon: true,
  hasMlxRunner: true,
  ...overrides,
});

const ids = (chain: readonly { id: string }[]): string[] => chain.map((backend) => backend.id);

afterEach(() => {
  delete process.env.WISS_MODEL;
});

describe('backendChain', () => {
  it('puts MLX first on Apple Silicon with the runner, CPU last always', () => {
    expect(ids(backendChain(profile()))).toEqual(['mlx', 'coreml', 'webgpu', 'cpu']);
  });

  it('skips MLX when the runner is not bundled', () => {
    expect(ids(backendChain(profile({ hasMlxRunner: false })))).toEqual(['coreml', 'webgpu', 'cpu']);
  });

  it('uses DirectML then CPU on Windows, and CPU alone on Linux', () => {
    expect(ids(backendChain(profile({ platform: 'win32', appleSilicon: false })))).toEqual(['dml', 'cpu']);
    expect(ids(backendChain(profile({ platform: 'linux', appleSilicon: false })))).toEqual(['cpu']);
  });
});

describe('modelFor', () => {
  it('picks large-v3 with a GPU and 16 GB, medium with a GPU and 5 GB', () => {
    const gpu = backendChain(profile());
    expect(modelFor(profile(), gpu).key).toBe('large-v3');
    expect(modelFor(profile({ totalRamBytes: 5_000_000_000 }), gpu).key).toBe('medium');
  });

  it('drops to small on CPU-only machines however much RAM is free', () => {
    const cpu = backendChain(profile({ platform: 'linux', appleSilicon: false }));
    expect(modelFor(profile({ totalRamBytes: 64_000_000_000 }), cpu).key).toBe('small');
  });

  it('honours WISS_MODEL, and ignores an unknown value', () => {
    process.env.WISS_MODEL = 'large-v3-turbo';
    expect(modelFor(profile(), backendChain(profile())).key).toBe('large-v3-turbo');
    process.env.WISS_MODEL = 'not-a-model';
    expect(modelFor(profile(), backendChain(profile())).key).toBe('large-v3');
  });
});

describe('MODELS', () => {
  it('gives every tier a distinct cache folder and a non-zero download size', () => {
    const keys = Object.keys(MODELS);
    expect(new Set(keys).size).toBe(keys.length);
    for (const spec of Object.values(MODELS)) {
      expect(spec.mlx.bytes).toBeGreaterThan(0);
      expect(spec.onnx.bytes).toBeGreaterThan(0);
    }
  });
});
