import { arch, availableParallelism, cpus, totalmem, type as osType } from 'node:os';
import { MODELS, isModelKey, type ModelSpec } from './models';

export type BackendId = 'mlx' | 'coreml' | 'webgpu' | 'dml' | 'cpu';

export interface BackendSpec {
  id: BackendId;
  label: string;
  gpu: boolean;
}

export interface SystemProfile {
  platform: NodeJS.Platform;
  arch: string;
  cpuModel: string;
  cores: number;
  totalRamBytes: number;
  appleSilicon: boolean;
  hasMlxRunner: boolean;
}

export interface RuntimePlan {
  profile: SystemProfile;
  /** Ordered fallback chain; the worker walks it until one backend loads. */
  backends: readonly BackendSpec[];
  model: ModelSpec;
  inferenceThreads: number;
  /** True when the model tier was pinned by WISS_MODEL rather than detected. */
  modelOverridden: boolean;
}

const BACKEND_LABELS: Record<BackendId, { label: string; gpu: boolean }> = {
  mlx: { label: 'Apple MLX', gpu: true },
  coreml: { label: 'Apple Core ML', gpu: true },
  webgpu: { label: 'WebGPU', gpu: true },
  dml: { label: 'DirectML GPU', gpu: true },
  cpu: { label: 'CPU', gpu: false },
};

/**
 * Ranked backend chain for this machine. Every Apple Silicon Mac and every
 * Windows box keeps a CPU entry at the end so a failed GPU init degrades to a
 * slower answer instead of a dead app.
 */
export function backendChain(profile: Pick<SystemProfile, 'platform' | 'appleSilicon' | 'hasMlxRunner'>): BackendSpec[] {
  const ids: BackendId[] = [];
  if (profile.platform === 'darwin') {
    if (profile.appleSilicon && profile.hasMlxRunner) ids.push('mlx');
    ids.push('coreml', 'webgpu');
  } else if (profile.platform === 'win32') {
    ids.push('dml');
  }
  ids.push('cpu');
  return ids.map((id) => ({ id, ...BACKEND_LABELS[id] }));
}

/**
 * ponytail: tier is chosen from total RAM and GPU presence only. Re-check free
 * RAM (macOS compresses and swaps, so free is noisy) if a model ever OOMs.
 *
 * Set WISS_MODEL=large-v3-turbo for the 463 MB / ~0.15x-RTF tier, which is the
 * fastest option on Apple Silicon and near-identical in accuracy.
 */
export function modelFor(profile: SystemProfile, backends: readonly BackendSpec[]): ModelSpec {
  const override = process.env.WISS_MODEL;
  if (override && isModelKey(override)) return MODELS[override];
  const hasGpu = backends.some((backend) => backend.gpu);
  if (!hasGpu) return MODELS.small;
  if (profile.totalRamBytes >= MODELS['large-v3'].minRamBytes) return MODELS['large-v3'];
  if (profile.totalRamBytes >= MODELS.medium.minRamBytes) return MODELS.medium;
  return MODELS.small;
}

export function detectSystem(hasMlxRunner: boolean): SystemProfile {
  return {
    platform: process.platform,
    arch: arch(),
    cpuModel: cpus()[0]?.model.trim() ?? osType(),
    cores: availableParallelism(),
    totalRamBytes: totalmem(),
    appleSilicon: process.platform === 'darwin' && arch() === 'arm64',
    hasMlxRunner,
  };
}

export function planRuntime(hasMlxRunner: boolean): RuntimePlan {
  const profile = detectSystem(hasMlxRunner);
  const backends = backendChain(profile);
  const override = process.env.WISS_MODEL;
  return {
    profile,
    backends,
    model: modelFor(profile, backends),
    inferenceThreads: Math.max(2, Math.min(4, profile.cores - 2)),
    modelOverridden: Boolean(override && isModelKey(override)),
  };
}

export function describeProfile(profile: SystemProfile): string {
  const ram = Math.round(profile.totalRamBytes / 1_000_000_000);
  return `${profile.cpuModel} · ${profile.cores} cores · ${ram} GB`;
}