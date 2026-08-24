import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import type { MenuItemConstructorOptions } from "electron";
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
let mainWindow: BrowserWindow | undefined;
let consoleWindow: BrowserWindow | undefined;
const splashDurationMs = 3_000;
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

const createWindow = async (options: {
  showWhenReady?: boolean;
  bounds?: Electron.Rectangle;
} = {}): Promise<BrowserWindow> => {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    ...(options.bounds ?? {}),
    show: false,
    backgroundColor: "#f5f7fb",
    fullscreen: core?.getConfig().clientFullscreen ?? false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    ...(process.platform === "darwin"
      ? { trafficLightPosition: { x: 14, y: 11 } }
      : {
          titleBarOverlay: {
            color: "#101a35",
            symbolColor: "#ffffff",
            height: 38,
          },
        }),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow = window;
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = undefined;
  });

  const uiReady = new Promise<void>((resolve) => {
    const handler = (event: Electron.IpcMainEvent): void => {
      if (event.sender !== window.webContents) return;
      ipcMain.removeListener("satellite:ui-ready", handler);
      resolve();
    };
    ipcMain.on("satellite:ui-ready", handler);
    window.once("closed", () => ipcMain.removeListener("satellite:ui-ready", handler));
  });
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    await window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    await window.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
  await uiReady;
  if (options.showWhenReady !== false) window.show();
  return window;
};

const createSplashWindow = async (): Promise<BrowserWindow> => {
  const config = await new ConfigStore().load();
  const splash = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    show: false,
    frame: false,
    resizable: false,
    transparent: true,
    hasShadow: false,
    fullscreen: config.clientFullscreen,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  splash.setAlwaysOnTop(true);
  const query = {
    view: "splash",
  };
  const ready = new Promise<void>((resolve) => {
    splash.once("ready-to-show", () => {
      splash.show();
      resolve();
    });
  });
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    const url = new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));
    await splash.loadURL(url.toString());
  } else {
    await splash.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
      { query },
    );
  }
  await ready;
  return splash;
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
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    ...(process.platform === "darwin"
      ? { trafficLightPosition: { x: 14, y: 11 } }
      : {
          titleBarOverlay: {
            color: "#101a35",
            symbolColor: "#ffffff",
            height: 38,
          },
        }),
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
  core = new SatelliteCore({ config, saveConfig: (next) => store.save(next), networkHistoryPath: path.join(app.getPath("userData"), "network-tests.json") });
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
  core.network.on("state", (state) => sendToRenderers("satellite:network-test", state));
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
  ipcMain.handle("satellite:get-network-test", () => core?.network.getState());
  ipcMain.handle("satellite:run-network-test", () => core?.runManualNetworkTest());
  ipcMain.handle("satellite:cancel-network-test", () => core?.network.cancel() ?? false);
  ipcMain.handle("satellite:get-activity", () =>
    structuredClone(recentActivity),
  );
  ipcMain.handle("satellite:open-console", () => openConsoleWindow());
  ipcMain.handle("satellite:set-titlebar-colors", (event, background: string, foreground: string) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (process.platform !== "darwin" && senderWindow && !senderWindow.isDestroyed())
      senderWindow.setTitleBarOverlay({ color: background, symbolColor: foreground, height: 38 });
  });
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
  const exportDiagnostics = async (): Promise<boolean> => {
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
  };
  const exportSettings = async (): Promise<boolean> => {
    const result = await dialog.showSaveDialog({
      title: "Export ARC Client Settings",
      defaultPath: "arc-client-settings.json",
      filters: [{ name: "ARC Client Settings", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return false;
    const { clientId: _clientId, ...portable } = core!.getConfig();
    await writeFile(
      result.filePath,
      `${JSON.stringify({ settingsVersion: 1, config: portable }, null, 2)}\n`,
      { mode: 0o600 },
    );
    return true;
  };
  const importSettings = async () => {
    const result = await dialog.showOpenDialog({
      title: "Import ARC Client Settings",
      properties: ["openFile"],
      filters: [{ name: "ARC Client Settings", extensions: ["json"] }],
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
  };
  const exportLogs = async (): Promise<boolean> => {
    const result = await dialog.showSaveDialog({
      title: "Export ARC Client Logs",
      defaultPath: `arc-client-logs-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return false;
    await diagnostics.exportLogs(result.filePath);
    return true;
  };
  ipcMain.handle("satellite:export-diagnostics", exportDiagnostics);
  ipcMain.handle("satellite:export-settings", exportSettings);
  ipcMain.handle("satellite:import-settings", importSettings);
  ipcMain.handle("satellite:export-logs", exportLogs);
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
  const menu: MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin"
      ? [{ label: app.name, submenu: [{ role: "about" as const }, { type: "separator" as const }, { role: "services" as const }, { type: "separator" as const }, { role: "hide" as const }, { role: "hideOthers" as const }, { role: "unhide" as const }, { type: "separator" as const }, { role: "quit" as const }] }]
      : []),
    {
      label: "File",
      submenu: [
        { label: "Import Settings…", accelerator: "CmdOrCtrl+O", click: () => void importSettings() },
        { label: "Export Settings…", accelerator: "CmdOrCtrl+Shift+S", click: () => void exportSettings() },
        { type: "separator" },
        { label: "Export Diagnostics…", click: () => void exportDiagnostics() },
        { label: "Export Logs…", click: () => void exportLogs() },
        { type: "separator" },
        process.platform === "darwin" ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        {
          label: "Add Trigger…",
          accelerator: "CmdOrCtrl+Shift+T",
          click: () => mainWindow?.webContents.send("satellite:menu-add-trigger", true),
        },
        { type: "separator" },
        { role: "undo" }, { role: "redo" }, { type: "separator" },
        { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { label: "System Console", accelerator: "CmdOrCtrl+Shift+C", click: () => void openConsoleWindow() },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menu));
  await core.start();
};

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const window = mainWindow;
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });
  app.whenReady().then(async () => {
    const splash = headless ? undefined : await createSplashWindow();
    if (splash)
      await new Promise((resolve) => setTimeout(resolve, splashDurationMs));
    await startCore();
    if (!headless) {
      const window = await createWindow({
        showWhenReady: false,
        bounds: splash?.getBounds(),
      });
      window.showInactive();
      if (splash && !splash.isDestroyed()) {
        // Give the compositor a frame to place the fully rendered main window
        // behind the transparent splash before its backdrop begins to fade.
        await new Promise((resolve) => setTimeout(resolve, 100));
        splash.webContents.send("satellite:splash-exit", true);
        await new Promise((resolve) => setTimeout(resolve, 500));
        splash.destroy();
      }
      window.show();
      window.focus();
    }
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
