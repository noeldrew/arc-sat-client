import { app, BrowserWindow, dialog, ipcMain } from "electron";
import started from "electron-squirrel-startup";
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ConfigStore, SatelliteConfigSchema } from "./core/config";
import type { ActivityEntry, SatelliteStatus } from "./core/events";
import { SatelliteCore } from "./core/satellite-core";
import { BrandingService } from "./core/branding";
import { Diagnostics } from "./core/diagnostics";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

if (started) app.quit();

let core: SatelliteCore | undefined;
let consoleWindow: BrowserWindow | undefined;
const headless = process.argv.includes("--headless");
let latestStatus: SatelliteStatus = {
  cloud: "stopped",
  localTransport: "stopped",
  localAppConnected: false,
  localAppRegistered: false,
  triggersRegistered: false,
};
const recentActivity: ActivityEntry[] = [];
const execFileAsync = promisify(execFile);

interface PortHolder {
  port: number;
  pid: number;
  command: string;
  user: string;
}

const findPortHolder = async (port: number): Promise<PortHolder | undefined> => {
  if (process.platform === "win32") {
    const { stdout } = await execFileAsync("netstat", ["-ano", "-p", "tcp"]);
    const line = stdout.split(/\r?\n/).find((candidate) => {
      const columns = candidate.trim().split(/\s+/);
      return columns[0] === "TCP" && columns[1]?.endsWith(`:${port}`) && columns[3] === "LISTENING";
    });
    if (!line) return undefined;
    const pid = Number(line.trim().split(/\s+/)[4]);
    const { stdout: tasks } = await execFileAsync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"]);
    return { port, pid, command: tasks.match(/^"([^"]+)/)?.[1] ?? "Unknown process", user: "" };
  }
  try {
    const { stdout } = await execFileAsync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]);
    const columns = stdout.trim().split(/\r?\n/)[1]?.trim().split(/\s+/);
    if (!columns || columns.length < 3) return undefined;
    return { port, command: columns[0]!, pid: Number(columns[1]), user: columns[2]! };
  } catch (error) {
    if ((error as { code?: number }).code === 1) return undefined;
    throw error;
  }
};

const waitForExit = async (pid: number, timeoutMs: number): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); }
    catch { return true; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
};

const sendToRenderers = (channel: string, payload: unknown): void => {
  for (const window of BrowserWindow.getAllWindows())
    window.webContents.send(channel, payload);
};

const createWindow = async (): Promise<void> => {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    show: false,
    backgroundColor: "#f5f7fb",
    fullscreen: core?.getConfig().clientFullscreen ?? false,
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
    await window.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
};

const openConsoleWindow = async (): Promise<void> => {
  if (consoleWindow && !consoleWindow.isDestroyed()) {
    if (consoleWindow.isMinimized()) consoleWindow.restore();
    consoleWindow.focus();
    return;
  }
  consoleWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 720,
    minHeight: 420,
    show: false,
    title: "ARC Client System Console",
    backgroundColor: "#0a1426",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  consoleWindow.on("closed", () => { consoleWindow = undefined; });
  consoleWindow.once("ready-to-show", () => consoleWindow?.show());
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    const url = new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    url.searchParams.set("view", "console");
    await consoleWindow.loadURL(url.toString());
  } else {
    await consoleWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
      { query: { view: "console" } },
    );
  }
};

const startCore = async (): Promise<void> => {
  const store = new ConfigStore();
  const diagnostics = new Diagnostics(
    path.join(app.getPath("userData"), "diagnostics"),
  );
  const config = await store.load();
  core = new SatelliteCore({ config, saveConfig: (next) => store.save(next) });
  core.events.on("status", (status: SatelliteStatus) => {
    latestStatus = status;
    sendToRenderers("satellite:status", status);
  });
  core.events.on("activity", (entry: ActivityEntry) => {
    recentActivity.push(entry);
    if (recentActivity.length > 1_000)
      recentActivity.splice(0, recentActivity.length - 1_000);
    sendToRenderers("satellite:activity", entry);
    void diagnostics.append(entry);
  });
  core.events.on("config", (next) => sendToRenderers("satellite:config", next));
  core.events.on("system-stats", (stats) =>
    sendToRenderers("satellite:system-stats", stats),
  );
  core.launcher.on("scheduled", (details) =>
    sendToRenderers("satellite:launch-scheduled", details),
  );
  core.launcher.on("cancelled", () =>
    sendToRenderers("satellite:launch-cancelled", true),
  );
  ipcMain.handle("satellite:get-status", () => latestStatus);
  ipcMain.handle("satellite:get-config", () => core?.getConfig());
  ipcMain.handle("satellite:get-branding", () =>
    new BrandingService(
      path.join(app.getPath("userData"), "branding-cache.json"),
    ).load(core!.getConfig().serverUrl),
  );
  ipcMain.handle(
    "satellite:launch-app",
    () => core?.launcher.launch("manual") ?? false,
  );
  ipcMain.handle(
    "satellite:cancel-launch",
    () => core?.launcher.cancelScheduled() ?? false,
  );
  ipcMain.handle("satellite:get-system-stats", () =>
    core?.monitor.getSnapshot(),
  );
  ipcMain.handle("satellite:get-activity", () =>
    structuredClone(recentActivity),
  );
  ipcMain.handle("satellite:open-console", () => openConsoleWindow());
  ipcMain.handle("satellite:get-port-conflict", async () => {
    const status = core?.getStatus();
    if (!core || status?.localTransport !== "error") return undefined;
    return findPortHolder(core.getConfig().localWsPort);
  });
  ipcMain.handle("satellite:recover-port", async (_event, expectedPid: number) => {
    if (!core || core.getStatus().localTransport !== "error")
      throw new Error("The local WebSocket is no longer in an error state.");
    const port = core.getConfig().localWsPort;
    const holder = await findPortHolder(port);
    if (!holder || holder.pid !== expectedPid)
      throw new Error("The process using the port has changed. Nothing was terminated.");
    if (!Number.isSafeInteger(holder.pid) || holder.pid <= 1 || holder.pid === process.pid)
      throw new Error("The identified process cannot be terminated safely.");
    core.events.log("system", { type: "port-recovery-confirmed", port, pid: holder.pid, command: holder.command });
    process.kill(holder.pid, "SIGTERM");
    if (!(await waitForExit(holder.pid, 2_000))) {
      process.kill(holder.pid, "SIGKILL");
      if (!(await waitForExit(holder.pid, 2_000)))
        throw new Error(`Process ${holder.pid} did not release port ${port}.`);
    }
    await core.restartLocalWebSocket();
    core.events.log("system", { type: "port-recovery-complete", port });
    return true;
  });
  ipcMain.handle("satellite:export-diagnostics", async () => {
    const result = await dialog.showSaveDialog({
      title: "Export ARC Client Diagnostics",
      defaultPath: `arc-client-diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return false;
    await diagnostics.export(
      result.filePath,
      core!.getConfig(),
      core!.getStatus(),
      core!.monitor.getSnapshot(),
    );
    return true;
  });
  ipcMain.handle("satellite:export-template", async () => {
    const result = await dialog.showSaveDialog({
      title: "Save ARC Client Template",
      defaultPath: "arc-client-template.json",
      filters: [{ name: "ARC Client Template", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return false;
    const { clientId: _clientId, ...portable } = core!.getConfig();
    await writeFile(
      result.filePath,
      `${JSON.stringify({ templateVersion: 1, config: portable }, null, 2)}\n`,
      { mode: 0o600 },
    );
    return true;
  });
  ipcMain.handle("satellite:import-template", async () => {
    const result = await dialog.showOpenDialog({
      title: "Import ARC Client Template",
      properties: ["openFile"],
      filters: [{ name: "ARC Client Template", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePaths[0]) return undefined;
    const parsed = JSON.parse(await readFile(result.filePaths[0], "utf8")) as {
      config?: Record<string, unknown>;
    } & Record<string, unknown>;
    const portable =
      parsed.config && typeof parsed.config === "object"
        ? parsed.config
        : parsed;
    const next = SatelliteConfigSchema.parse({
      ...portable,
      schemaVersion: 1,
      clientId: core!.getConfig().clientId,
    });
    await core!.updateConfig(next);
    return next;
  });
  ipcMain.handle("satellite:choose-application", async () => {
    const result = await dialog.showOpenDialog({
      title: "Choose Application or File",
      properties: ["openFile"],
    });
    return result.canceled ? undefined : result.filePaths[0];
  });
  ipcMain.handle(
    "satellite:detect-process",
    async (_event, selectedPath: string) => {
      if (
        process.platform === "darwin" &&
        selectedPath.toLowerCase().endsWith(".app")
      ) {
        try {
          const plist = await readFile(
            path.join(selectedPath, "Contents", "Info.plist"),
            "utf8",
          );
          const match = plist.match(
            /<key>CFBundleExecutable<\/key>\s*<string>([^<]+)<\/string>/,
          );
          if (match?.[1]) return match[1];
        } catch {
          /* Fall back to the application bundle name. */
        }
      }
      return path.basename(selectedPath, path.extname(selectedPath));
    },
  );
  ipcMain.handle("satellite:get-zones", async () => {
    const config = core!.getConfig();
    if (!config.siteId || !config.apiToken)
      return {
        available: false,
        zones: [],
        reason:
          "Assign this client to a site and provide its API token to load zones.",
      };
    try {
      const response = await fetch(
        `${config.serverUrl.replace(/\/$/, "")}/api/v1/satellite-clients/client-config/zones`,
        {
          headers: { Authorization: `Bearer ${config.apiToken}` },
          signal: AbortSignal.timeout(8_000),
        },
      );
      if (!response.ok)
        return {
          available: false,
          zones: [],
          reason: `The server did not make zones available (${response.status}).`,
        };
      const raw = (await response.json()) as Array<{
        id: string;
        name: string;
      }>;
      return {
        available: true,
        zones: raw.map((zone) => ({ id: zone.id, name: zone.name })),
      };
    } catch (error) {
      return {
        available: false,
        zones: [],
        reason: error instanceof Error ? error.message : String(error),
      };
    }
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

app.on("before-quit", () => {
  void core?.stop();
});
