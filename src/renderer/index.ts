import './styles.css';
import type { DictationStatus, ModelStatus, RuntimeInfo } from '../shared';
import { StreamingLinearResampler } from './audio';

const appRoot = document.querySelector<HTMLDivElement>('#app');
if (!appRoot) throw new Error('Missing app root');
const app: HTMLDivElement = appRoot;
const mode = new URLSearchParams(location.search).get('mode') ?? 'settings';
document.body.classList.add(`mode-${mode}`);

const escapeHtml = (value: string): string =>
  value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]!);

function formatTimer(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
  return `${Math.round(bytes / 1_000_000)} MB`;
}

class MicrophoneController {
  private stream?: MediaStream;
  private context?: AudioContext;
  private source?: MediaStreamAudioSourceNode;
  private processor?: ScriptProcessorNode;
  private sink?: GainNode;
  private resampler?: StreamingLinearResampler;
  private active = false;

  async start(): Promise<void> {
    if (this.active) return;
    this.active = true;
    try {
      this.stream ??= await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: { ideal: 16_000 },
        },
        video: false,
      });
      this.context ??= new AudioContext({ latencyHint: 'interactive', sampleRate: 16_000 });
      if (this.context.state === 'suspended') await this.context.resume();
      this.source = this.context.createMediaStreamSource(this.stream);
      this.processor = this.context.createScriptProcessor(4096, 1, 1);
      this.sink = this.context.createGain();
      this.sink.gain.value = 0;
      const inputRate = this.context.sampleRate;
      this.resampler = inputRate === 16_000 ? undefined : new StreamingLinearResampler(inputRate, 16_000);
      this.processor.onaudioprocess = (event) => {
        if (!this.active) return;
        const input = event.inputBuffer.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < input.length; i += 1) sum += input[i]! * input[i]!;
        const level = Math.min(1, Math.sqrt(sum / input.length) * 5.5);
        const samples = this.resampler?.process(input) ?? new Float32Array(input);
        window.wiss.sendAudio(samples, level);
      };
      this.source.connect(this.processor);
      this.processor.connect(this.sink);
      this.sink.connect(this.context.destination);
    } catch (error) {
      this.active = false;
      console.error('Unable to start microphone', error);
    }
  }

  stop(): void {
    this.active = false;
    this.processor?.disconnect();
    this.source?.disconnect();
    this.sink?.disconnect();
    this.processor = undefined;
    this.source = undefined;
    this.sink = undefined;
    this.resampler = undefined;
  }
}

const mic = new MicrophoneController();
window.wiss.onCaptureStart(() => void mic.start());
window.wiss.onCaptureStop(() => mic.stop());

if (mode === 'overlay') renderOverlay();
else void renderSettings();

function renderOverlay(): void {
  const heights = [7, 11, 17, 23, 30, 21, 13, 9, 15, 25, 32, 24, 16, 10, 7];
  app.innerHTML = `
    <div class="overlay-wrap">
      <div class="recorder-shell" id="shell">
        <div class="recorder-pill" id="pill" aria-label="Voice recording in progress">
          <div class="live-wave" aria-hidden="true">
            ${heights.map((height, index) => `<i style="--h:${height}px;--d:${index * -0.055}s"></i>`).join('')}
          </div>
        </div>
        <div class="timer-tab" id="timer">00:00</div>
      </div>
      <div class="live-text" id="live-text" role="status" aria-live="polite"></div>
    </div>`;

  const pill = document.querySelector<HTMLDivElement>('#pill')!;
  const shell = document.querySelector<HTMLDivElement>('#shell')!;
  const timer = document.querySelector<HTMLDivElement>('#timer')!;
  const live = document.querySelector<HTMLDivElement>('#live-text')!;
  let status: DictationStatus = { phase: 'idle' };
  let startedAt = 0;

  window.wiss.onStatus((next) => {
    status = next;
    if (next.startedAt) startedAt = next.startedAt;
    pill.classList.toggle('transcribing', next.phase === 'transcribing');
    pill.classList.toggle('error', next.phase === 'error');
    pill.style.setProperty('--voice', String(next.level ?? (next.phase === 'transcribing' ? 0.12 : 0)));
    const text = next.transcript ?? '';
    if (live.textContent !== text) {
      live.textContent = text;
      // Keep only the tail that fits; long dictations scroll rather than grow.
      live.scrollTop = live.scrollHeight;
    }
    shell.classList.toggle('has-text', Boolean(text));
  });

  const tick = () => {
    timer.textContent = formatTimer(status.phase === 'idle' || !startedAt ? 0 : Date.now() - startedAt);
    requestAnimationFrame(tick);
  };
  tick();
}

async function renderSettings(): Promise<void> {
  let info = await window.wiss.getRuntimeInfo();

  const render = () => {
    app.innerHTML = info.modelStatus.phase === 'ready' ? readyView(info) : setupView(info);
    bindControls();
  };

  const bindControls = () => {
    document.querySelector('#retry-model')?.addEventListener('click', () => {
      void window.wiss.downloadModel().catch(() => undefined);
    });
    document.querySelector('#permissions')?.addEventListener('click', async () => {
      info = await window.wiss.requestPermissions();
      render();
    });
    document.querySelector('#fillers-toggle')?.addEventListener('click', async () => {
      info = await window.wiss.updateSettings({ removeFillers: !info.settings.removeFillers });
      render();
    });
    document.querySelector('#commands-toggle')?.addEventListener('click', async () => {
      info = await window.wiss.updateSettings({ smartCommands: !info.settings.smartCommands });
      render();
    });
    document.querySelector('#access-settings')?.addEventListener('click', () => void window.wiss.openAccessibilitySettings());
    document.querySelector('#input-settings')?.addEventListener('click', () => void window.wiss.openInputMonitoringSettings());
  };

  window.wiss.onModelStatus((status) => {
    info = { ...info, modelReady: status.phase === 'ready', modelStatus: status };
    render();
  });
  render();
}

function brandHeader(): string {
  return `<header class="brand-row">
    <div class="brand"><img src="./logo.png" alt="" /><div><strong>OmniX Wiss</strong><span>Private voice typing</span></div></div>
    <div class="local-badge"><i></i> Local by design</div>
  </header>`;
}

function setupView(info: RuntimeInfo): string {
  const status = info.modelStatus;
  const isError = status.phase === 'error';
  const isLoading = status.phase === 'loading';
  const percent = isLoading ? 100 : Math.max(0, Math.min(100, Math.round(status.progress * 100)));
  const progress = `<i style="width:${isError ? 100 : percent}%"></i>`;
  const progressControl = isError
    ? `<button class="compact-progress has-error" id="retry-model" aria-label="Retry model download" title="${escapeHtml(status.message ?? 'Retry model download')}">${progress}</button>`
    : `<div class="compact-progress ${isLoading ? 'is-loading' : ''}" role="progressbar" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100">${progress}</div>`;

  return `<main class="compact-setup">
    <img src="./logo.png" alt="OmniX Wiss" />
    <div class="compact-download">
      <div class="compact-download-meta"><span>${isError ? 'Installation paused' : isLoading ? 'Preparing model' : 'Installing model'}</span><strong>${percent}%</strong></div>
      ${progressControl}
    </div>
  </main>`;
}

function readyView(info: RuntimeInfo): string {
  const micOk = info.microphoneStatus === 'granted';
  const accessOk = info.platform !== 'darwin' || info.accessibilityTrusted;
  const model = info.modelStatus.modelName;
  // Slice(1): the first entry is the backend that actually loaded, not a fallback.
  const fallbacks = info.backendChain.slice(1);
  return `<main class="settings-shell ready-shell">
    ${brandHeader()}
    <section class="ready-hero">
      <div class="ready-mark"><span></span></div>
      <div><div class="eyebrow">READY</div><h1>Speak. Release. It lands.</h1><p>${escapeHtml(model)} detects the language, cleans the transcript, and types into the field you already selected.</p></div>
      <div class="shortcut"><kbd>${escapeHtml(info.hotkeyLabel)}</kbd><span>hold to dictate</span></div>
    </section>
    <section class="control-grid">
      <article class="model-card">
        <div class="card-label">VOICE ENGINE</div>
        <div class="model-title"><span class="model-glyph">W</span><div><strong>${escapeHtml(model)}</strong><small>${escapeHtml(info.modelStatus.quantization)} · automatic language detection</small></div></div>
        <div class="model-stats"><span><b>${escapeHtml(info.modelStatus.backend ?? 'Local')}</b> inference</span><span><b>${formatBytes(info.modelStatus.totalBytes)}</b> on disk</span></div>
        <div class="model-detected"><span>${escapeHtml(info.hardware)}</span>${fallbacks.length ? `<span>fallback: ${escapeHtml(fallbacks.join(' → '))}</span>` : ''}</div>
      </article>
      <article class="polish-card">
        <div class="card-label">WRITING POLISH</div>
        ${settingToggle('fillers-toggle', 'Remove fillers & repeats', 'Cuts “um”, “uh”, and immediate repeated words.', info.settings.removeFillers)}
        ${settingToggle('commands-toggle', 'Spoken formatting', 'Say “new line”, “comma”, or “question mark”.', info.settings.smartCommands)}
      </article>
    </section>
    <section class="system-card">
      <div><div class="card-label">SYSTEM ACCESS</div><strong>Microphone ${micOk ? 'ready' : 'needed'} · Accessibility ${accessOk ? 'ready' : 'needed'} · Keyboard monitoring</strong></div>
      <button class="secondary-btn" id="permissions">${micOk && accessOk ? 'Manage' : 'Enable'}</button>
    </section>
    <section class="preference-row">
      <div><strong>Background service</strong><span>Starts with your computer and stays ready in the tray.</span></div>
      <div class="service-state"><i></i> Always on</div>
    </section>
    <footer class="footer"><span>v${escapeHtml(info.version)} · offline after setup</span><div><button id="access-settings">Accessibility</button><button id="input-settings">Input Monitoring</button></div></footer>
  </main>`;
}

function settingToggle(id: string, title: string, detail: string, enabled: boolean): string {
  return `<div class="setting-toggle"><div><strong>${title}</strong><small>${detail}</small></div><button id="${id}" class="switch ${enabled ? 'on' : ''}" aria-label="${title}"><i></i></button></div>`;
}
