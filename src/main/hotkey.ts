import { UiohookKey, uIOhook, type UiohookKeyboardEvent } from 'uiohook-napi';

export type HoldPhase = 'idle' | 'armed' | 'active' | 'chorded';

export interface HoldToTalkOptions {
  activationKeys: readonly number[];
  holdDelayMs: number;
  onArm?: () => void;
  onStart: () => void;
  onStop: () => void;
}

/**
 * macOS sends auto-repeat keydowns for a held modifier, and the queue can
 * deliver one *after* the keyup. A repeat landing in 'idle' would re-arm and
 * pop the overlay with no key held, so repeats inside this window are dropped.
 * Far below the ~80 ms floor of a deliberate second press.
 */
const REPEAT_GUARD_MS = 50;

export class HoldToTalkGesture {
  private phase: HoldPhase = 'idle';
  private timer?: ReturnType<typeof setTimeout>;
  private activeKey?: number;
  private releasedAt = 0;

  constructor(private readonly options: HoldToTalkOptions) {}

  get currentPhase(): HoldPhase {
    return this.phase;
  }

  keyDown(keycode: number): void {
    if (this.options.activationKeys.includes(keycode)) {
      if (this.phase !== 'idle') return;
      if (Date.now() - this.releasedAt < REPEAT_GUARD_MS) return;
      this.phase = 'armed';
      this.activeKey = keycode;
      this.options.onArm?.();
      this.timer = setTimeout(() => {
        if (this.phase !== 'armed') return;
        this.phase = 'active';
        this.options.onStart();
      }, this.options.holdDelayMs);
      return;
    }

    // Preserve normal shortcuts: Command+C / Command+V etc. cancel the arm
    // before dictation starts. Once dictation is active, speech owns the hold.
    if (this.phase === 'armed') {
      this.clearTimer();
      this.phase = 'chorded';
    }
  }

  /**
   * Any activation key ending the gesture, not just the one that armed it:
   * uIOhook reports the left and right modifier under different keycodes on
   * macOS, and matching on `activeKey` alone strands the phase in 'active' —
   * which leaves the overlay on screen with nothing held down.
   */
  keyUp(keycode: number): void {
    if (!this.options.activationKeys.includes(keycode)) return;
    this.clearTimer();
    this.releasedAt = Date.now();
    const wasActive = this.phase === 'active';
    this.phase = 'idle';
    this.activeKey = undefined;
    if (wasActive) this.options.onStop();
  }

  cancel(): void {
    this.clearTimer();
    this.releasedAt = Date.now();
    const wasActive = this.phase === 'active';
    this.phase = 'idle';
    this.activeKey = undefined;
    if (wasActive) this.options.onStop();
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}

export interface GlobalPushToTalkOptions {
  holdDelayMs: number;
  onArm?: () => void;
  onStart: () => void;
  onStop: () => void;
}

export class GlobalPushToTalk {
  private readonly gesture: HoldToTalkGesture;
  private started = false;
  private readonly keyDownHandler = (event: UiohookKeyboardEvent) => this.gesture.keyDown(event.keycode);
  private readonly keyUpHandler = (event: UiohookKeyboardEvent) => this.gesture.keyUp(event.keycode);

  constructor(options: GlobalPushToTalkOptions) {
    const activationKeys = process.platform === 'darwin'
      ? [UiohookKey.Alt, UiohookKey.AltRight]
      : [UiohookKey.F8];
    this.gesture = new HoldToTalkGesture({ ...options, activationKeys });
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    uIOhook.on('keydown', this.keyDownHandler);
    uIOhook.on('keyup', this.keyUpHandler);
    uIOhook.start();
  }

  stop(): void {
    if (!this.started) return;
    this.gesture.cancel();
    uIOhook.off('keydown', this.keyDownHandler);
    uIOhook.off('keyup', this.keyUpHandler);
    uIOhook.stop();
    this.started = false;
  }

  static label(): string {
    return process.platform === 'darwin' ? '⌥' : 'F8';
  }
}
