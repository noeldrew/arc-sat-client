import { app, BrowserWindow, dialog, ipcMain } from "electron";
import started from "electron-squirrel-startup";
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { ConfigStore, SatelliteConfigSchema } from "./core/config";
import type { ActivityEntry, SatelliteStatus } from "./core/events";
import { SatelliteCore } from "./core/satellite-core";
import { BrandingService } from "./core/branding";
import { Diagnostics } from "./core/diagnostics";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

if (started) app.quit();

let core: SatelliteCore | undefined;
const headless = process.argv.includes("--headless");
let latestStatus: SatelliteStatus = { cloud: "stopped", localTransport: "stopped", localAppConnected: false };
const recentActivity: ActivityEntry[] = [];

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
  const diagnostics = new Diagnostics(path.join(app.getPath("userData"), "diagnostics"));
  const config = await store.load();
  core = new SatelliteCore({ config, saveConfig: (next) => store.save(next) });
  core.events.on("status", (status: SatelliteStatus) => { latestStatus = status; sendToRenderers("satellite:status", status); });
  core.events.on("activity", (entry: ActivityEntry) => { recentActivity.push(entry); if (recentActivity.length > 1_000) recentActivity.splice(0, recentActivity.length - 1_000); sendToRenderers("satellite:activity", entry); void diagnostics.append(entry); });
  core.events.on("config", (next) => sendToRenderers("satellite:config", next));
  core.events.on("system-stats", (stats) => sendToRenderers("satellite:system-stats", stats));
  core.launcher.on("scheduled", (details) => sendToRenderers("satellite:launch-scheduled", details));
  core.launcher.on("cancelled", () => sendToRenderers("satellite:launch-cancelled", true));
  ipcMain.handle("satellite:get-status", () => latestStatus);
  ipcMain.handle("satellite:get-config", () => core?.getConfig());
  ipcMain.handle("satellite:get-branding", () => new BrandingService(path.join(app.getPath("userData"), "branding-cache.json")).load(core!.getConfig().serverUrl));
  ipcMain.handle("satellite:launch-app", () => core?.launcher.launch("manual") ?? false);
  ipcMain.handle("satellite:cancel-launch", () => core?.launcher.cancelScheduled() ?? false);
  ipcMain.handle("satellite:get-system-stats", () => core?.monitor.getSnapshot());
  ipcMain.handle("satellite:get-activity", () => structuredClone(recentActivity));
  ipcMain.handle("satellite:export-diagnostics", async () => {
    const result = await dialog.showSaveDialog({ title: "Export ARC Client Diagnostics", defaultPath: `arc-client-diagnostics-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: "JSON", extensions: ["json"] }] });
    if (result.canceled || !result.filePath) return false;
    await diagnostics.export(result.filePath, core!.getConfig(), core!.getStatus(), core!.monitor.getSnapshot()); return true;
  });
  ipcMain.handle("satellite:export-template", async () => {
    const result = await dialog.showSaveDialog({ title: "Save ARC Client Template", defaultPath: "arc-client-template.json", filters: [{ name: "ARC Client Template", extensions: ["json"] }] });
    if (result.canceled || !result.filePath) return false;
    const { clientId: _clientId, ...portable } = core!.getConfig();
    await writeFile(result.filePath, `${JSON.stringify({ templateVersion: 1, config: portable }, null, 2)}\n`, { mode: 0o600 });
    return true;
  });
  ipcMain.handle("satellite:import-template", async () => {
    const result = await dialog.showOpenDialog({ title: "Import ARC Client Template", properties: ["openFile"], filters: [{ name: "ARC Client Template", extensions: ["json"] }] });
    if (result.canceled || !result.filePaths[0]) return undefined;
    const parsed = JSON.parse(await readFile(result.filePaths[0], "utf8")) as { config?: Record<string, unknown> } & Record<string, unknown>;
    const portable = parsed.config && typeof parsed.config === "object" ? parsed.config : parsed;
    const next = SatelliteConfigSchema.parse({ ...portable, schemaVersion: 1, clientId: core!.getConfig().clientId });
    await core!.updateConfig(next);
    return next;
  });
  ipcMain.handle("satellite:choose-application", async () => {
    const result = await dialog.showOpenDialog({ title: "Choose Application or File", properties: ["openFile"] });
    return result.canceled ? undefined : result.filePaths[0];
  });
  ipcMain.handle("satellite:detect-process", async (_event, selectedPath: string) => {
    if (process.platform === "darwin" && selectedPath.toLowerCase().endsWith(".app")) {
      try {
        const plist = await readFile(path.join(selectedPath, "Contents", "Info.plist"), "utf8");
        const match = plist.match(/<key>CFBundleExecutable<\/key>\s*<string>([^<]+)<\/string>/);
        if (match?.[1]) return match[1];
      } catch { /* Fall back to the application bundle name. */ }
    }
    return path.basename(selectedPath, path.extname(selectedPath));
  });
  ipcMain.handle("satellite:get-zones", async () => {
    const config = core!.getConfig();
    if (!config.siteId || !config.apiToken) return { available: false, zones: [], reason: "Set a Site ID and API token to load zones." };
    try {
      const response = await fetch(`${config.serverUrl.replace(/\/$/, "")}/api/v1/venues/sites/${config.siteId}/zones`, { headers: { Authorization: `Bearer ${config.apiToken}` }, signal: AbortSignal.timeout(8_000) });
      if (!response.ok) return { available: false, zones: [], reason: `The server did not make zones available (${response.status}).` };
      const raw = await response.json() as Array<{ id: string; name: string }>;
      return { available: true, zones: raw.map((zone) => ({ id: zone.id, name: zone.name })) };
    } catch (error) { return { available: false, zones: [], reason: error instanceof Error ? error.message : String(error) }; }
  });
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
    if (!headless) await createWindow();
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});

app.on("before-quit", () => { void core?.stop(); });
