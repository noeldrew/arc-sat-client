import { app, BrowserWindow, ipcMain } from "electron";
import started from "electron-squirrel-startup";
import path from "node:path";
import { ConfigStore, SatelliteConfigSchema } from "./core/config";
import type { ActivityEntry, SatelliteStatus } from "./core/events";
import { SatelliteCore } from "./core/satellite-core";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

if (started) app.quit();

let core: SatelliteCore | undefined;
let latestStatus: SatelliteStatus = { cloud: "stopped", localTransport: "stopped", localAppConnected: false };

const sendToRenderers = (channel: string, payload: unknown): void => {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel, payload);
};

const createWindow = async (): Promise<void> => {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    show: false,
    backgroundColor: "#f5f7fb",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once("ready-to-show", () => window.show());
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    await window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    await window.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
};

const startCore = async (): Promise<void> => {
  const store = new ConfigStore();
  const config = await store.load();
  core = new SatelliteCore({ config, saveConfig: (next) => store.save(next) });
  core.events.on("status", (status: SatelliteStatus) => { latestStatus = status; sendToRenderers("satellite:status", status); });
  core.events.on("activity", (entry: ActivityEntry) => sendToRenderers("satellite:activity", entry));
  core.events.on("config", (next) => sendToRenderers("satellite:config", next));
  ipcMain.handle("satellite:get-status", () => latestStatus);
  ipcMain.handle("satellite:get-config", () => core?.getConfig());
  ipcMain.handle("satellite:update-config", async (_event, raw) => {
    const next = SatelliteConfigSchema.parse(raw);
    await core?.updateConfig(next);
    return next;
  });
  await core.start();
};

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });
  app.whenReady().then(async () => {
    await startCore();
    await createWindow();
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});

app.on("before-quit", () => { void core?.stop(); });
