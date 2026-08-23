import { EventEmitter } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import type { SatelliteConfig } from "./config";
import { SatelliteEvents } from "./events";

export class AppLauncher extends EventEmitter {
  private child?: ChildProcess;
  private lastLaunchAt = 0;
  private pending?: NodeJS.Timeout;

  constructor(private getConfig: () => SatelliteConfig, private readonly events: SatelliteEvents) { super(); }

  schedule(reason: "cloud-connect" | "session" | "process-stopped"): void {
    if (this.pending) clearTimeout(this.pending);
    const delay = this.getConfig().launcher.delaySeconds;
    this.events.log("system", { type: "app-launch-scheduled", reason, delaySeconds: delay });
    this.emit("scheduled", { reason, delaySeconds: delay });
    this.pending = setTimeout(() => { this.pending = undefined; this.launch(reason); }, delay * 1_000);
  }

  cancelScheduled(): boolean { if (!this.pending) return false; clearTimeout(this.pending); this.pending = undefined; this.events.log("system", { type: "app-launch-cancelled" }); this.emit("cancelled"); return true; }

  launch(reason: "manual" | "cloud-connect" | "session" | "process-stopped" = "manual"): boolean {
    const config = this.getConfig().launcher;
    if (config.type === "none") return false;
    try {
      let command: string;
      let args: string[];
      let shell = false;
      if (config.type === "script") {
        if (!config.script.trim()) return false;
        command = config.script;
        args = [];
        shell = true;
      } else {
        if (!config.path.trim()) return false;
        if (process.platform === "darwin" && path.extname(config.path).toLowerCase() === ".app") {
          command = "open"; args = [config.path];
        } else { command = config.path; args = []; }
      }
      this.child = spawn(command, args, { shell, detached: true, windowsHide: true, stdio: "ignore" });
      this.child.unref();
      this.lastLaunchAt = Date.now();
      this.events.log("system", { type: "app-launched", reason, target: config.type === "file" ? config.path : "configured script" });
      this.emit("launched", { reason, at: new Date().toISOString() });
      this.child.once("error", (error) => this.events.log("error", { source: "launcher", detail: error.message }));
      return true;
    } catch (error) {
      this.events.log("error", { source: "launcher", detail: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }

  relaunchAfterProcessStop(): boolean {
    const config = this.getConfig().launcher;
    if (!config.autoRelaunch) return false;
    if (Date.now() - this.lastLaunchAt < config.relaunchCooldownSeconds * 1_000) return false;
    this.schedule("process-stopped"); return true;
  }
}
