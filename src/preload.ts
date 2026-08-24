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
  getNetworkTest: () => ipcRenderer.invoke("satellite:get-network-test"),
  runNetworkTest: () => ipcRenderer.invoke("satellite:run-network-test"),
  cancelNetworkTest: () => ipcRenderer.invoke("satellite:cancel-network-test"),
  getActivity: () => ipcRenderer.invoke("satellite:get-activity"),
  openConsole: () => ipcRenderer.invoke("satellite:open-console"),
  setTitlebarColors: (background: string, foreground: string) => ipcRenderer.invoke("satellite:set-titlebar-colors", background, foreground),
  getPortConflict: () => ipcRenderer.invoke("satellite:get-port-conflict"),
  recoverPort: (pid: number) => ipcRenderer.invoke("satellite:recover-port", pid),
  launchApp: () => ipcRenderer.invoke("satellite:launch-app"),
  cancelLaunch: () => ipcRenderer.invoke("satellite:cancel-launch"),
  exportDiagnostics: () => ipcRenderer.invoke("satellite:export-diagnostics"),
  exportSettings: () => ipcRenderer.invoke("satellite:export-settings"),
  importSettings: () => ipcRenderer.invoke("satellite:import-settings"),
  exportLogs: () => ipcRenderer.invoke("satellite:export-logs"),
  chooseApplication: () => ipcRenderer.invoke("satellite:choose-application"),
  detectProcess: (selectedPath: string) => ipcRenderer.invoke("satellite:detect-process", selectedPath),
  getZones: () => ipcRenderer.invoke("satellite:get-zones"),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  updateConfig: (config: unknown) => ipcRenderer.invoke("satellite:update-config", config),
  onStatus: (listener: (value: unknown) => void) => subscribe("satellite:status", listener),
  onActivity: (listener: (value: unknown) => void) => subscribe("satellite:activity", listener),
  onConfig: (listener: (value: unknown) => void) => subscribe("satellite:config", listener),
  onSystemStats: (listener: (value: unknown) => void) => subscribe("satellite:system-stats", listener),
  onNetworkTest: (listener: (value: unknown) => void) => subscribe("satellite:network-test", listener),
  onLaunchScheduled: (listener: (value: unknown) => void) => subscribe("satellite:launch-scheduled", listener),
  onLaunchCancelled: (listener: (value: unknown) => void) => subscribe("satellite:launch-cancelled", listener),
  onAddTrigger: (listener: () => void) => subscribe("satellite:menu-add-trigger", listener),
});
