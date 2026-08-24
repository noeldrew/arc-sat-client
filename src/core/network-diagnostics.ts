import { EventEmitter } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import si from "systeminformation";
import type { SatelliteConfig } from "./config";
import type { SatelliteEvents } from "./events";

export type NetworkTestStage = "idle" | "adapter" | "latency" | "download" | "upload" | "complete" | "failed" | "cancelled";
export interface NetworkTestResult {
  testedAt: string; reason: "startup" | "manual"; status: "good" | "degraded" | "failed" | "cancelled";
  adapterName?: string; adapterType?: string; ip4?: string; linkSpeedMbps?: number;
  latencyMs?: number; jitterMs?: number; downloadMbps?: number; uploadMbps?: number;
  reasons: string[]; error?: string;
}
export interface NetworkTestState { running: boolean; stage: NetworkTestStage; result?: NetworkTestResult; history: NetworkTestResult[]; }

export class NetworkDiagnostics extends EventEmitter {
  private controller?: AbortController;
  private state: NetworkTestState = { running: false, stage: "idle", history: [] };
  constructor(private getConfig: () => SatelliteConfig, private events: SatelliteEvents, private historyPath?: string) { super(); }
  async load(): Promise<void> { if (!this.historyPath) return; try { this.state.history = JSON.parse(await readFile(this.historyPath, "utf8")); } catch { /* first run */ } }
  getState(): NetworkTestState { return structuredClone(this.state); }
  cancel(): boolean { if (!this.controller) return false; this.controller.abort(); return true; }
  private publish(stage: NetworkTestStage): void { this.state.stage = stage; this.emit("state", this.getState()); }
  private async save(): Promise<void> { if (!this.historyPath) return; await mkdir(path.dirname(this.historyPath), { recursive: true }); await writeFile(this.historyPath, JSON.stringify(this.state.history, null, 2)); }

  async run(reason: "startup" | "manual"): Promise<NetworkTestResult> {
    if (this.state.running) throw new Error("A network test is already running.");
    const config = this.getConfig();
    const result: NetworkTestResult = { testedAt: new Date().toISOString(), reason, status: "failed", reasons: [] };
    this.controller = new AbortController(); this.state.running = true; this.publish("adapter");
    const timeout = setTimeout(() => this.controller?.abort(), 20_000);
    try {
      const adapter = await si.networkInterfaces("default");
      result.adapterName = adapter.ifaceName || adapter.iface;
      result.adapterType = adapter.type; result.ip4 = adapter.ip4;
      result.linkSpeedMbps = adapter.speed ?? undefined;
      if (!config.apiToken) throw new Error("An API token is required to test the ARC connection.");
      const base = `${config.serverUrl.replace(/\/$/, "")}/api/v1/satellite-clients/network-test`;
      const headers = { Authorization: `Bearer ${config.apiToken}`, "Cache-Control": "no-cache" };
      this.publish("latency");
      const samples: number[] = [];
      for (let index = 0; index < 3; index++) { const start = performance.now(); const response = await fetch(`${base}/ping?t=${Date.now()}-${index}`, { headers, signal: this.controller.signal }); if (!response.ok) throw new Error(`ARC latency test failed (${response.status})`); await response.json(); samples.push(performance.now() - start); }
      result.latencyMs = samples.reduce((a, b) => a + b, 0) / samples.length;
      result.jitterMs = samples.slice(1).reduce((total, value, index) => total + Math.abs(value - samples[index]!), 0) / Math.max(1, samples.length - 1);
      this.publish("download");
      const downloadStart = performance.now(); const download = await fetch(`${base}/download?size=${8 * 1024 * 1024}&t=${Date.now()}`, { headers, signal: this.controller.signal });
      if (!download.ok) throw new Error(`ARC download test failed (${download.status})`); const downloaded = (await download.arrayBuffer()).byteLength;
      result.downloadMbps = downloaded * 8 / ((performance.now() - downloadStart) / 1000) / 1_000_000;
      this.publish("upload");
      const body = new Uint8Array(4 * 1024 * 1024); const uploadStart = performance.now();
      const upload = await fetch(`${base}/upload`, { method: "POST", headers: { ...headers, "Content-Type": "application/octet-stream" }, body, signal: this.controller.signal });
      if (!upload.ok) throw new Error(`ARC upload test failed (${upload.status})`); await upload.json();
      result.uploadMbps = body.byteLength * 8 / ((performance.now() - uploadStart) / 1000) / 1_000_000;
      if (result.latencyMs > config.monitoring.networkLatencyThresholdMs) result.reasons.push(`Latency ${result.latencyMs.toFixed(0)} ms`);
      if (result.downloadMbps < config.monitoring.networkDownloadMinimumMbps) result.reasons.push(`Download ${result.downloadMbps.toFixed(1)} Mbps`);
      if (result.uploadMbps < config.monitoring.networkUploadMinimumMbps) result.reasons.push(`Upload ${result.uploadMbps.toFixed(1)} Mbps`);
      result.status = result.reasons.length ? "degraded" : "good"; this.publish("complete");
    } catch (error) {
      result.status = this.controller.signal.aborted ? "cancelled" : "failed";
      result.error = result.status === "cancelled" ? "Test cancelled" : error instanceof Error ? error.message : String(error);
      this.publish(result.status === "cancelled" ? "cancelled" : "failed");
    } finally { clearTimeout(timeout); this.controller = undefined; this.state.running = false; this.state.result = result; this.state.history = [result, ...this.state.history].slice(0, 10); await this.save(); this.emit("state", this.getState()); this.emit("result", structuredClone(result)); this.events.log("system", { type: "network-test", ...result }); }
    return result;
  }
}
