export type ModelKey = 'large-v3' | 'large-v3-turbo' | 'medium' | 'small';

export interface ModelSpec {
  key: ModelKey;
  label: string;
  params: string;
  quantization: string;
  /** Approximate resident memory needed to run; used to pick a tier. */
  minRamBytes: number;
  /** Weight file size used only for the "on disk" label in settings. */
  approxBytes: number;
  /** Exact weights.npz size, so a partial download is caught before it loads. */
  mlx: { repo: string; revision: string; bytes: number };
  onnx: { repo: string; revision: string; dtype: string; bytes: number };
}

/**
 * Apple Silicon uses the MLX builds; everything else uses the ONNX builds.
 *
 * ponytail: every MLX repo here ships `weights.npz` because that is the only
 * filename the bundled PyInstaller runner knows how to load. Newer conversions
 * that ship `model.safetensors` need a runner rebuild before they can be used.
 */
export const MODELS: Readonly<Record<ModelKey, ModelSpec>> = {
  'large-v3': {
    key: 'large-v3',
    label: 'Whisper Large v3',
    params: '1.55B',
    quantization: '4-bit',
    minRamBytes: 8 * 1_000_000_000,
    approxBytes: 1_225_000_000,
    mlx: {
      repo: 'mlx-community/whisper-large-v3-mlx-4bit',
      revision: 'd12b5d0043a6fe0c59af321617fba041d4e8e0c8',
      bytes: 973_563_040,
    },
    onnx: {
      repo: 'onnx-community/whisper-large-v3-ONNX',
      revision: '3b6257ad5e67aa523c7c07f4fea04d445eecc4a6',
      dtype: 'q4',
      bytes: 1_225_000_000,
    },
  },
  'large-v3-turbo': {
    key: 'large-v3-turbo',
    label: 'Whisper Large v3 Turbo',
    params: '809M',
    quantization: '4-bit',
    minRamBytes: 4 * 1_000_000_000,
    approxBytes: 464_000_000,
    mlx: {
      repo: 'mlx-community/whisper-large-v3-turbo-q4',
      revision: '660c343bbf4e52ac257f0b7d952e5388e6f93bef',
      bytes: 463_664_664,
    },
    onnx: {
      repo: 'onnx-community/whisper-large-v3-turbo',
      revision: '360ebcde2559d60bb474678be3c1de9ef347d01a',
      dtype: 'q4',
      bytes: 1_419_000_000,
    },
  },
  medium: {
    key: 'medium',
    label: 'Whisper Medium',
    params: '769M',
    quantization: '4-bit',
    minRamBytes: 3 * 1_000_000_000,
    approxBytes: 1_585_000_000,
    mlx: {
      repo: 'mlx-community/whisper-medium-mlx-4bit',
      revision: '29c89182c8557049c004210f96febc8b5ee97c89',
      bytes: 512_230_640,
    },
    onnx: {
      repo: 'onnx-community/whisper-medium-ONNX',
      revision: 'd3978248a6b5de6df7ec29ddfbde3993845fa806',
      dtype: 'q4',
      bytes: 1_585_000_000,
    },
  },
  small: {
    key: 'small',
    label: 'Whisper Small',
    params: '244M',
    quantization: '4-bit',
    minRamBytes: 0,
    approxBytes: 755_000_000,
    mlx: {
      repo: 'mlx-community/whisper-small-mlx-4bit',
      revision: 'f1da4c67f2ee8b6e763b974e149aa65d5b7658b7',
      bytes: 196_537_352,
    },
    onnx: {
      repo: 'onnx-community/whisper-small-ONNX',
      revision: 'd946fdacaf9d70f84e964dd7a78394721a771fad',
      dtype: 'q4',
      bytes: 755_000_000,
    },
  },
};

/** Cache directory for one (backend, model) pair. Keeps tiers side by side. */
export function modelCacheFolder(spec: Pick<ModelSpec, 'key'>, backend: 'mlx' | 'onnx'): string {
  return `${backend}/${spec.key}`;
}

/** Download total for whichever backend is about to be used. */
export function modelBytes(spec: Pick<ModelSpec, 'mlx' | 'onnx'>, backend: 'mlx' | 'onnx'): number {
  return backend === 'mlx' ? spec.mlx.bytes : spec.onnx.bytes;
}

export function isModelKey(value: unknown): value is ModelKey {
  return typeof value === 'string' && value in MODELS;
}

/**
 * Pick the winning language from Whisper's first decoder pass. The language
 * tokens are the last `vocabSize` entries of the logits.
 */
export function selectDetectedLanguage(
  logits: ArrayLike<number>,
  vocabSize: number,
  languageTokens: Record<string, number>,
): string {
  const offset = logits.length - vocabSize;
  let bestLanguage = 'en';
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const [token, id] of Object.entries(languageTokens)) {
    const score = logits[offset + id];
    if (score !== undefined && score > bestScore) {
      bestScore = score;
      bestLanguage = token.replace(/^<\|/, '').replace(/\|>$/, '');
    }
  }
  return bestLanguage;
}