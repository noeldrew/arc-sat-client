import { contextBridge, ipcRenderer, webUtils } from "electron";

const subscribe = <T>(channel: string, listener: (value: T) => void): (() => void) => {
  const wrapped = (_event: Electron.IpcRendererEvent, value: T): void => listener(value);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
};

contextBridge.exposeInMainWorld("arcSatellite", {
  platform: process.platform,
  version: process.versions.electron,
  getStatus: () => ipcRenderer.invoke("satellite:get-status"),
  getConfig: () => ipcRenderer.invoke("satellite:get-config"),
  getBranding: () => ipcRenderer.invoke("satellite:get-branding"),
  getSystemStats: () => ipcRenderer.invoke("satellite:get-system-stats"),
  getActivity: () => ipcRenderer.invoke("satellite:get-activity"),
  launchApp: () => ipcRenderer.invoke("satellite:launch-app"),
  cancelLaunch: () => ipcRenderer.invoke("satellite:cancel-launch"),
  exportDiagnostics: () => ipcRenderer.invoke("satellite:export-diagnostics"),
  exportTemplate: () => ipcRenderer.invoke("satellite:export-template"),
  importTemplate: () => ipcRenderer.invoke("satellite:import-template"),
  chooseApplication: () => ipcRenderer.invoke("satellite:choose-application"),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  updateConfig: (config: unknown) => ipcRenderer.invoke("satellite:update-config", config),
  onStatus: (listener: (value: unknown) => void) => subscribe("satellite:status", listener),
  onActivity: (listener: (value: unknown) => void) => subscribe("satellite:activity", listener),
  onConfig: (listener: (value: unknown) => void) => subscribe("satellite:config", listener),
  onSystemStats: (listener: (value: unknown) => void) => subscribe("satellite:system-stats", listener),
  onLaunchScheduled: (listener: (value: unknown) => void) => subscribe("satellite:launch-scheduled", listener),
  onLaunchCancelled: (listener: (value: unknown) => void) => subscribe("satellite:launch-cancelled", listener),
});
