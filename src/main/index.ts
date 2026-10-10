import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  session,
  shell,
  systemPreferences,
  Tray,
} from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, type AppSettings, type DictationStatus, type ModelStatus, type RuntimeInfo } from '../shared';
import { WhisperAsr } from './asr';
import { describeProfile, planRuntime, type RuntimePlan } from './capabilities';
import { GlobalPushToTalk } from './hotkey';
import { TextInjector } from './text-injector';
import { polishTranscript } from './transcript';
import { WhisperModelManager } from './whisper-model';

let settings: AppSettings = { ...DEFAULT_SETTINGS };
let settingsWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let hotkey: GlobalPushToTalk | null = null;
let asr: WhisperAsr | null = null;
let modelManager: WhisperModelManager | null = null;
let plan: RuntimePlan | null = null;
const textInjector = new TextInjector();
let isQuitting = false;
let dictationStartedAt = 0;
let activationHeld = false;
let finalizing = false;
let dictationParts: string[] = [];
let setupDismissed = false;

const SETUP_WINDOW_SIZE = { width: 360, height: 200 };
const OPTIONS_WINDOW_SIZE = { width: 650, height: 720 };
const OVERLAY_WIDTH = 196;
const OVERLAY_BASE_HEIGHT = 58;
const OVERLAY_ROW_HEIGHT = 15;
const CHARS_PER_ROW = 30;
const MAX_OVERLAY_ROWS = 6;
const MAX_OVERLAY_CHARS = CHARS_PER_ROW * MAX_OVERLAY_ROWS;

function rendererTarget(mode: 'settings' | 'overlay'): { url?: string; file?: string; query?: Record<string, string> } {
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    return { url: `${process.env.ELECTRON_RENDERER_URL}?mode=${mode}` };
  }
  return { file: join(__dirname, '../renderer/index.html'), query: { mode } };
}

async function loadRenderer(window: BrowserWindow, mode: 'settings' | 'overlay'): Promise<void> {
  const target = rendererTarget(mode);
  if (target.url) await window.loadURL(target.url);
  else await window.loadFile(target.file!, { query: target.query });
}

function preloadPath(): string {
  return join(__dirname, '../preload/index.cjs');
}

function logoPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'branding', 'logo.png') : join(app.getAppPath(), 'public', 'logo.png');
}

function modelCacheDir(): string {
  return join(app.getPath('userData'), 'models');
}

function mlxRunnerPath(): string | undefined {
  if (process.platform !== 'darwin') return undefined;
  return app.isPackaged
    ? join(process.resourcesPath, 'mlx-runner', 'wiss-mlx-runner')
    : join(app.getAppPath(), 'resources', 'mlx-runner', 'wiss-mlx-runner');
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json');
}

function loadSettings(): void {
  try {
    const saved = JSON.parse(readFileSync(settingsPath(), 'utf8')) as Partial<AppSettings>;
    settings = {
      ...DEFAULT_SETTINGS,
      removeFillers: typeof saved.removeFillers === 'boolean' ? saved.removeFillers : DEFAULT_SETTINGS.removeFillers,
      smartCommands: typeof saved.smartCommands === 'boolean' ? saved.smartCommands : DEFAULT_SETTINGS.smartCommands,
    };
  } catch {
    settings = { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(): void {
  mkdirSync(app.getPath('userData'), { recursive: true });
  writeFileSync(settingsPath(), `${JSON.stringify({
    removeFillers: settings.removeFillers,
    smartCommands: settings.smartCommands,
  }, null, 2)}\n`);
}

function ensureBackgroundService(): void {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true });
}

function microphoneStatus(): string {
  if (process.platform === 'darwin' || process.platform === 'win32') {
    return systemPreferences.getMediaAccessStatus('microphone');
  }
  return 'unknown';
}

function accessibilityTrusted(prompt = false): boolean {
  return process.platform !== 'darwin' || systemPreferences.isTrustedAccessibilityClient(prompt);
}

function runtimeInfo(): RuntimeInfo {
  const login = app.getLoginItemSettings();
  settings = { ...settings, launchAtLogin: login.openAtLogin };
  const detected = plan ?? (plan = planRuntime(mlxRunnerPath() !== undefined));
  return {
    platform: process.platform,
    modelReady: modelManager?.ready ?? false,
    modelPath: modelCacheDir(),
    modelStatus: modelManager?.status ?? {
      phase: 'missing',
      progress: 0,
      downloadedBytes: 0,
      totalBytes: detected.model.approxBytes,
      modelName: detected.model.label,
      quantization: detected.model.quantization,
    },
    accessibilityTrusted: accessibilityTrusted(false),
    microphoneStatus: microphoneStatus(),
    settings,
    hotkeyLabel: GlobalPushToTalk.label(),
    version: app.getVersion(),
    hardware: describeProfile(detected.profile),
    backendChain: detected.backends.map((backend) => backend.label),
  };
}

function sendStatus(status: DictationStatus): void {
  overlayWindow?.webContents.send('dictation:status', status);
  settingsWindow?.webContents.send('dictation:status', status);
}

function sendModelStatus(status: ModelStatus): void {
  settingsWindow?.webContents.send('model:status', status);
  if (status.phase === 'ready') {
    settingsWindow?.hide();
    setupDismissed = false;
    return;
  }
  if (settingsWindow?.isVisible()) resizeSettingsWindow(SETUP_WINDOW_SIZE.width, SETUP_WINDOW_SIZE.height, 340, 180);
}

function resizeSettingsWindow(width: number, height: number, minWidth: number, minHeight: number): void {
  if (!settingsWindow) return;
  settingsWindow.setMinimumSize(minWidth, minHeight);
  settingsWindow.setSize(width, height, false);
  settingsWindow.center();
}

function showSetupWindow(activate = false): void {
  if (!settingsWindow) return;
  setupDismissed = false;
  resizeSettingsWindow(SETUP_WINDOW_SIZE.width, SETUP_WINDOW_SIZE.height, 340, 180);
  if (activate) settingsWindow.show();
  else settingsWindow.showInactive();
}

function showOptionsWindow(): void {
  if (!settingsWindow) return;
  if (modelManager?.status.phase !== 'ready') {
    showSetupWindow(true);
    return;
  }
  resizeSettingsWindow(OPTIONS_WINDOW_SIZE.width, OPTIONS_WINDOW_SIZE.height, 600, 660);
  settingsWindow.show();
}

async function captureVerificationUi(): Promise<void> {
  if (app.isPackaged || process.env.WISS_CAPTURE_UI !== '1' || !settingsWindow || !overlayWindow) return;
  const directory = join(app.getAppPath(), 'dist', 'verification');
  mkdirSync(directory, { recursive: true });
  const settingsImage = await settingsWindow.webContents.capturePage();
  const overlayImage = await overlayWindow.webContents.capturePage();
  writeFileSync(join(directory, 'settings.png'), settingsImage.toPNG());
  writeFileSync(join(directory, 'overlay.png'), overlayImage.toPNG());
  console.log('Captured verification UI:', directory);
}

async function createSettingsWindow(): Promise<void> {
  settingsWindow = new BrowserWindow({
    width: SETUP_WINDOW_SIZE.width,
    height: SETUP_WINDOW_SIZE.height,
    minWidth: 340,
    minHeight: 180,
    show: false,
    title: 'OmniX Wiss',
    backgroundColor: '#050d3d',
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  settingsWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      if (modelManager?.status.phase !== 'ready') setupDismissed = true;
      settingsWindow?.hide();
    }
  });
  await loadRenderer(settingsWindow, 'settings');
}

async function createOverlayWindow(): Promise<void> {
  overlayWindow = new BrowserWindow({
    width: OVERLAY_WIDTH,
    height: OVERLAY_BASE_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  overlayWindow.setAlwaysOnTop(true, process.platform === 'darwin' ? 'floating' : 'normal');
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  if (process.platform === 'darwin') overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  await loadRenderer(overlayWindow, 'overlay');
}

function positionAndShowOverlay(): void {
  if (!overlayWindow) return;
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const bounds = display.workArea;
  const [width, height] = overlayWindow.getSize();
  const x = bounds.x + Math.round((bounds.width - width) / 2);
  const y = bounds.y + bounds.height - height - 18;
  overlayWindow.setPosition(Math.round(x), Math.round(y), false);
  overlayWindow.showInactive();
}

/** Grow the overlay downward to fit the live transcript, never past the work area. */
function sizeOverlayForTranscript(text: string): void {
  if (!overlayWindow) return;
  const characters = Math.min(MAX_OVERLAY_CHARS, text.length);
  const rows = characters === 0 ? 0 : Math.min(MAX_OVERLAY_ROWS, Math.ceil(characters / CHARS_PER_ROW));
  const height = OVERLAY_BASE_HEIGHT + rows * OVERLAY_ROW_HEIGHT;
  const [currentWidth, currentHeight] = overlayWindow.getSize();
  if (currentHeight === height) return;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const clamped = Math.min(height, display.workArea.height - 24);
  overlayWindow.setSize(currentWidth, clamped, false);
  positionAndShowOverlay();
}

function ensureAsr(): WhisperAsr | null {
  if (asr) return asr;
  if (!modelManager?.ready) return null;
  const usingAppleMlx = modelManager.status.backend === 'Apple MLX';
  asr = new WhisperAsr(modelManager, {
    silenceThreshold: settings.silenceThreshold,
    silenceMs: settings.silenceMs,
    // Bound continuous speech so the GPU can decode one segment while the next
    // is still being recorded instead of doing all work after key release.
    maxSegmentMs: usingAppleMlx ? Math.min(settings.segmentMaxMs, 10_000) : settings.segmentMaxMs,
    flushOnSilence: usingAppleMlx,
    onTranscript: async (text) => {
      const polished = polishTranscript(text, settings);
      if (!polished) return;
      dictationParts.push(polished);
      // Segments decode while the key is still held, so the overlay can show
      // the running text instead of only the waveform.
      const transcript = dictationParts.join(' ');
      sizeOverlayForTranscript(transcript);
      sendStatus({
        phase: activationHeld ? 'recording' : 'transcribing',
        startedAt: dictationStartedAt,
        transcript,
      });
    },
    onError: (message) => {
      console.error('ASR error:', message);
      sendStatus({ phase: 'error', startedAt: dictationStartedAt, message });
    },
  });
  return asr;
}

function startDictation(): void {
  if (!settingsWindow || !overlayWindow || finalizing) return;
  const recognizer = ensureAsr();
  if (!recognizer) {
    overlayWindow.hide();
    if (!setupDismissed) showSetupWindow(false);
    return;
  }
  activationHeld = true;
  dictationStartedAt = Date.now();
  dictationParts = [];
  textInjector.begin();
  recognizer.startSession();
  sizeOverlayForTranscript('');
  positionAndShowOverlay();
  sendStatus({ phase: 'recording', startedAt: dictationStartedAt });
  settingsWindow.webContents.send('capture:start');
}

function stopDictation(): void {
  if (!settingsWindow || !dictationStartedAt || !asr || finalizing) return;
  activationHeld = false;
  finalizing = true;
  settingsWindow.webContents.send('capture:stop');
  overlayWindow?.hide();
  sendStatus({ phase: 'transcribing', startedAt: dictationStartedAt, message: 'Finishing…' });
  void asr.finishSession().then(async () => {
    const transcript = dictationParts.join(' ').trim();
    if (transcript) await textInjector.append(transcript);
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Unable to insert transcript:', message);
    sendStatus({ phase: 'error', startedAt: dictationStartedAt, message });
  }).finally(async () => {
    await textInjector.end();
    dictationParts = [];
    sendStatus({ phase: 'idle' });
    dictationStartedAt = 0;
    finalizing = false;
  });
}

function createTray(): void {
  const icon = nativeImage.createFromPath(logoPath()).resize({ width: 18, height: 18 });
  tray = new Tray(icon);
  tray.setToolTip('OmniX Wiss — hold to dictate');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'OmniX Wiss', enabled: false },
    { label: `Hold ${GlobalPushToTalk.label()} to dictate`, enabled: false },
    { type: 'separator' },
    { label: 'Options…', click: showOptionsWindow },
    { type: 'separator' },
    { label: 'Quit OmniX Wiss', click: () => { isQuitting = true; app.quit(); } },
  ]));
  tray.on('click', showOptionsWindow);
}

function installIpc(): void {
  ipcMain.handle('runtime:get', () => runtimeInfo());
  ipcMain.handle('permissions:request', async () => {
    if (process.platform === 'darwin') {
      const accessibilityReady = accessibilityTrusted(true);
      if (microphoneStatus() !== 'granted') await systemPreferences.askForMediaAccess('microphone');
      // Global modifier-only keys are delivered by macOS only after Input
      // Monitoring is enabled. Accessibility alone is not sufficient.
      if (accessibilityReady) {
        await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent');
      }
    }
    return runtimeInfo();
  });
  ipcMain.handle('permissions:open-accessibility', async () => {
    if (process.platform === 'darwin') {
      await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
    }
  });
  ipcMain.handle('permissions:open-input-monitoring', async () => {
    if (process.platform === 'darwin') {
      await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent');
    }
  });
  ipcMain.handle('settings:launch-at-login', (_event, enabled: boolean) => {
    app.setLoginItemSettings({ openAtLogin: app.isPackaged ? true : Boolean(enabled), openAsHidden: true });
    return runtimeInfo();
  });
  ipcMain.handle('settings:update', (_event, patch: Partial<AppSettings>) => {
    if (typeof patch.removeFillers === 'boolean') settings.removeFillers = patch.removeFillers;
    if (typeof patch.smartCommands === 'boolean') settings.smartCommands = patch.smartCommands;
    saveSettings();
    return runtimeInfo();
  });
  ipcMain.handle('model:download', async () => {
    await modelManager?.prepare(true);
    return modelManager?.status;
  });
  ipcMain.handle('window:show-settings', showOptionsWindow);
  ipcMain.handle('window:hide-settings', () => settingsWindow?.hide());
  ipcMain.on('audio:samples', (_event, samples: Float32Array, level: number) => {
    if (!activationHeld || !asr || !(samples instanceof Float32Array)) return;
    asr.push(samples, Number.isFinite(level) ? level : 0);
    sendStatus({ phase: 'recording', startedAt: dictationStartedAt, level: Number.isFinite(level) ? level : 0 });
  });
}

function installPermissionGuards(): void {
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => permission === 'media');
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media');
  });
}

function startGlobalHotkey(): void {
  hotkey = new GlobalPushToTalk({
    holdDelayMs: settings.holdDelayMs,
    onStart: startDictation,
    onStop: stopDictation,
  });
  try {
    hotkey.start();
  } catch (error) {
    console.error('Global key hook failed:', error);
    sendStatus({ phase: 'error', message: 'Keyboard access is required. Open OmniX Wiss Settings.' });
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', showOptionsWindow);
  app.whenReady().then(async () => {
    app.setAppUserModelId('com.omnix.wiss');
    if (process.platform === 'darwin' && app.isPackaged) app.dock?.hide();
    installPermissionGuards();
    installIpc();
    loadSettings();
    ensureBackgroundService();
    modelManager = new WhisperModelManager(modelCacheDir(), sendModelStatus, planRuntime(mlxRunnerPath() !== undefined), mlxRunnerPath());
    await createSettingsWindow();
    await createOverlayWindow();
    createTray();
    startGlobalHotkey();
    const info = runtimeInfo();
    if (!info.modelReady && info.modelStatus.phase !== 'loading') {
      showSetupWindow(false);
      if (!app.isPackaged) console.log('Wiss settings window:', settingsWindow?.getBounds(), 'visible=', settingsWindow?.isVisible());
    } else if (!app.isPackaged && process.env.WISS_SHOW_SETTINGS === '1') {
      showOptionsWindow();
    }
    void modelManager.prepare(true).then(() => {
      ensureAsr();
    }).catch((error: unknown) => {
      console.error('Unable to prepare Whisper Large v3:', error);
    });
    if (!app.isPackaged && process.env.WISS_DEMO_OVERLAY === '1') {
      positionAndShowOverlay();
      sendStatus({ phase: 'recording', startedAt: Date.now(), message: 'Visual verification mode' });
      console.log('Wiss overlay window:', overlayWindow?.getBounds(), 'visible=', overlayWindow?.isVisible());
    }
    if (!app.isPackaged && process.env.WISS_CAPTURE_UI === '1') {
      setTimeout(() => void captureVerificationUi(), 500);
    }
  });
}

app.on('before-quit', () => {
  isQuitting = true;
  hotkey?.stop();
  // Do not wait for a native decoder round-trip during OS shutdown. Closing
  // the worker's pipes also lets the persistent MLX runner exit immediately.
  modelManager?.shutdownNow();
  overlayWindow?.destroy();
  settingsWindow?.destroy();
  tray?.destroy();
});

app.on('window-all-closed', () => {
  // Intentional: OmniX Wiss is a menu-bar/tray background utility.
});
