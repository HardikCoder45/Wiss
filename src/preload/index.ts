import { contextBridge, ipcRenderer } from 'electron';
import type { DictationStatus, ModelStatus, RuntimeInfo, WissBridge } from '../shared';

const bridge: WissBridge = {
  getRuntimeInfo: () => ipcRenderer.invoke('runtime:get') as Promise<RuntimeInfo>,
  requestPermissions: () => ipcRenderer.invoke('permissions:request') as Promise<RuntimeInfo>,
  openAccessibilitySettings: () => ipcRenderer.invoke('permissions:open-accessibility') as Promise<void>,
  openInputMonitoringSettings: () => ipcRenderer.invoke('permissions:open-input-monitoring') as Promise<void>,
  setLaunchAtLogin: (enabled) => ipcRenderer.invoke('settings:launch-at-login', enabled) as Promise<RuntimeInfo>,
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch) as Promise<RuntimeInfo>,
  downloadModel: () => ipcRenderer.invoke('model:download') as Promise<ModelStatus>,
  showSettings: () => ipcRenderer.invoke('window:show-settings') as Promise<void>,
  hideSettings: () => ipcRenderer.invoke('window:hide-settings') as Promise<void>,
  sendAudio: (samples, level) => {
    ipcRenderer.send('audio:samples', samples, level);
  },
  onCaptureStart: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('capture:start', handler);
    return () => ipcRenderer.off('capture:start', handler);
  },
  onCaptureStop: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('capture:stop', handler);
    return () => ipcRenderer.off('capture:stop', handler);
  },
  onStatus: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, status: DictationStatus) => callback(status);
    ipcRenderer.on('dictation:status', handler);
    return () => ipcRenderer.off('dictation:status', handler);
  },
  onModelStatus: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, status: ModelStatus) => callback(status);
    ipcRenderer.on('model:status', handler);
    return () => ipcRenderer.off('model:status', handler);
  },
};

contextBridge.exposeInMainWorld('wiss', bridge);

declare global {
  interface Window {
    wiss: WissBridge;
  }
}
