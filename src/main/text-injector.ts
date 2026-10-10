import { clipboard } from 'electron';
import { UiohookKey, uIOhook } from 'uiohook-napi';

export class TextInjector {
  private originalClipboard = '';
  private lastPayload = '';
  private active = false;

  begin(): void {
    if (this.active) return;
    this.originalClipboard = clipboard.readText();
    this.lastPayload = '';
    this.active = true;
  }

  async append(text: string): Promise<void> {
    const normalized = text.trim();
    if (!normalized) return;
    if (!this.active) this.begin();
    const payload = `${normalized} `;
    clipboard.writeText(payload);
    this.lastPayload = payload;

    if (process.platform === 'darwin') {
      uIOhook.keyTap(UiohookKey.V, [UiohookKey.Meta]);
    } else {
      uIOhook.keyTap(UiohookKey.V, [UiohookKey.Ctrl]);
    }
    await new Promise((resolve) => setTimeout(resolve, 24));
  }

  async end(): Promise<void> {
    if (!this.active) return;
    await new Promise((resolve) => setTimeout(resolve, 80));
    // Do not overwrite a clipboard value the user changed during dictation.
    if (clipboard.readText() === this.lastPayload) clipboard.writeText(this.originalClipboard);
    this.active = false;
    this.originalClipboard = '';
    this.lastPayload = '';
  }
}
