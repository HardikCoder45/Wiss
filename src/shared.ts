export type DictationPhase = 'idle' | 'arming' | 'recording' | 'transcribing' | 'error';

export interface DictationStatus {
  phase: DictationPhase;
  startedAt?: number;
  elapsedMs?: number;
  level?: number;
  message?: string;
  /** Everything decoded so far this session, live. */
  transcript?: string;
}

export interface AppSettings {
  launchAtLogin: boolean;
  holdDelayMs: number;
  segmentMaxMs: number;
  silenceMs: number;
  silenceThreshold: number;
  removeFillers: boolean;
  smartCommands: boolean;
}

export const DEFAULT_SETTINGS: Readonly<AppSettings> = {
  launchAtLogin: true,
  holdDelayMs: 220,
  segmentMaxMs: 28_000,
  silenceMs: 900,
  silenceThreshold: 0.018,
  removeFillers: true,
  smartCommands: true,
};

export type ModelPhase = 'missing' | 'downloading' | 'loading' | 'ready' | 'error';

export interface ModelStatus {
  phase: ModelPhase;
  progress: number;
  downloadedBytes: number;
  totalBytes: number;
  modelName: string;
  quantization: string;
  backend?: string;
  message?: string;
}

export interface RuntimeInfo {
  platform: NodeJS.Platform;
  modelReady: boolean;
  modelPath: string;
  modelStatus: ModelStatus;
  accessibilityTrusted: boolean;
  microphoneStatus: string;
  settings: AppSettings;
  hotkeyLabel: string;
  version: string;
  /** Detected hardware, shown in settings. */
  hardware: string;
  /** Ordered inference backends; the first is the one that loaded. */
  backendChain: string[];
}

export type Unsubscribe = () => void;

export interface WissBridge {
  getRuntimeInfo(): Promise<RuntimeInfo>;
  requestPermissions(): Promise<RuntimeInfo>;
  openAccessibilitySettings(): Promise<void>;
  openInputMonitoringSettings(): Promise<void>;
  setLaunchAtLogin(enabled: boolean): Promise<RuntimeInfo>;
  updateSettings(patch: Partial<Pick<AppSettings, 'removeFillers' | 'smartCommands'>>): Promise<RuntimeInfo>;
  downloadModel(): Promise<ModelStatus>;
  showSettings(): Promise<void>;
  hideSettings(): Promise<void>;
  sendAudio(samples: Float32Array, level: number): void;
  onCaptureStart(callback: () => void): Unsubscribe;
  onCaptureStop(callback: () => void): Unsubscribe;
  onStatus(callback: (status: DictationStatus) => void): Unsubscribe;
  onModelStatus(callback: (status: ModelStatus) => void): Unsubscribe;
}
