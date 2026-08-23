import { contextBridge, ipcRenderer } from "electron";

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
  updateConfig: (config: unknown) => ipcRenderer.invoke("satellite:update-config", config),
  onStatus: (listener: (value: unknown) => void) => subscribe("satellite:status", listener),
  onActivity: (listener: (value: unknown) => void) => subscribe("satellite:activity", listener),
  onConfig: (listener: (value: unknown) => void) => subscribe("satellite:config", listener),
});
