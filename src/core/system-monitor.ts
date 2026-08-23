import { EventEmitter } from "node:events";
import si from "systeminformation";
import type { SatelliteConfig } from "./config";
import { SatelliteEvents } from "./events";

export interface SystemSnapshot {
  cpu_percent: number;
  cpu_per_core: number[];
  cpu_freq_ghz?: number;
  ram_percent: number;
  ram_used_mb: number;
  ram_total_mb: number;
  swap_percent: number;
  disk_percent?: number;
  disk_used_gb?: number;
  disk_total_gb?: number;
  uptime_seconds: number;
  processes: Record<string, boolean>;
  os: string;
  os_version: string;
  hostname: string;
  sampled_at: string;
}

export const healthReasons = (snapshot: SystemSnapshot, config: SatelliteConfig): string[] => {
  const reasons: string[] = [];
  if (snapshot.cpu_percent >= config.monitoring.cpuThreshold) reasons.push(`CPU ${snapshot.cpu_percent.toFixed(1)}%`);
  if (snapshot.ram_percent >= config.monitoring.ramThreshold) reasons.push(`RAM ${snapshot.ram_percent.toFixed(1)}%`);
  if (snapshot.disk_percent !== undefined && snapshot.disk_percent >= config.monitoring.diskThreshold) reasons.push(`Disk ${snapshot.disk_percent.toFixed(1)}%`);
  return reasons;
};

export class SystemMonitor extends EventEmitter {
  private timer?: NodeJS.Timeout;
  private lastSnapshot?: SystemSnapshot;
  private previousProcesses = new Map<string, boolean>();
  private collecting = false;

  constructor(private getConfig: () => SatelliteConfig, private readonly events: SatelliteEvents) { super(); }

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), Math.max(3, this.getConfig().monitoring.intervalSeconds) * 1_000);
  }

  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
  getSnapshot(): SystemSnapshot | undefined { return this.lastSnapshot ? structuredClone(this.lastSnapshot) : undefined; }

  async sample(): Promise<SystemSnapshot> {
    const config = this.getConfig();
    const [load, memory, filesystem, time, os, processes, cpu] = await Promise.all([
      si.currentLoad(), si.mem(), si.fsSize(), si.time(), si.osInfo(), si.processes(), si.cpuCurrentSpeed(),
    ]);
    const monitored = new Map(config.monitoring.processes.map((name) => [name, false]));
    for (const process of processes.list) {
      for (const name of monitored.keys()) {
        if (process.name.toLocaleLowerCase() === name.toLocaleLowerCase()) monitored.set(name, true);
      }
    }
    const root = filesystem.find((disk) => disk.mount === (process.platform === "win32" ? "C:" : "/")) ?? filesystem[0];
    return {
      cpu_percent: load.currentLoad,
      cpu_per_core: load.cpus.map((entry) => entry.load),
      cpu_freq_ghz: cpu.avg,
      ram_percent: memory.total ? (memory.active / memory.total) * 100 : 0,
      ram_used_mb: Math.round(memory.active / 1024 / 1024),
      ram_total_mb: Math.round(memory.total / 1024 / 1024),
      swap_percent: memory.swaptotal ? (memory.swapused / memory.swaptotal) * 100 : 0,
      disk_percent: root?.use,
      disk_used_gb: root ? root.used / 1024 / 1024 / 1024 : undefined,
      disk_total_gb: root ? root.size / 1024 / 1024 / 1024 : undefined,
      uptime_seconds: time.uptime,
      processes: Object.fromEntries(monitored),
      os: os.platform,
      os_version: os.release,
      hostname: os.hostname,
      sampled_at: new Date().toISOString(),
    };
  }

  private async tick(): Promise<void> {
    if (this.collecting) return;
    this.collecting = true;
    try {
      const snapshot = await this.sample();
      this.lastSnapshot = snapshot;
      this.emit("snapshot", snapshot);
      this.emit("health", healthReasons(snapshot, this.getConfig()));
      for (const [name, running] of Object.entries(snapshot.processes)) {
        const previous = this.previousProcesses.get(name);
        if (previous !== undefined && previous !== running) this.emit("process-change", { name, running, at: snapshot.sampled_at });
        this.previousProcesses.set(name, running);
      }
    } catch (error) {
      this.events.log("error", { source: "system-monitor", detail: error instanceof Error ? error.message : String(error) });
    } finally { this.collecting = false; }
  }
}
