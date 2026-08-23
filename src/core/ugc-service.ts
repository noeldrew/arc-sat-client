import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import type { SatelliteConfig } from "./config";

export interface UgcRequest { file_path?: string; customer_id?: string; site_id?: string; label?: string; category?: string; }

export class UgcService {
  constructor(private getConfig: () => SatelliteConfig) {}

  async upload(request: UgcRequest, sessionCustomerId?: string): Promise<Record<string, unknown>> {
    if (!request.file_path) return { type: "ugc_error", ok: false, detail: "file_path is required" };
    const config = this.getConfig(); const customerId = request.customer_id ?? sessionCustomerId; const siteId = request.site_id ?? config.siteId;
    if (!customerId) return { type: "ugc_error", ok: false, detail: "customer_id is required" };
    if (!siteId) return { type: "ugc_error", ok: false, detail: "site_id is required — configure it in Satellite settings" };
    try {
      const data = await readFile(request.file_path); const form = new FormData();
      form.append("file", new Blob([data]), path.basename(request.file_path)); form.append("customer_id", customerId); form.append("site_id", siteId);
      if (request.label) form.append("label", request.label); if (request.category) form.append("category", request.category);
      const response = await fetch(`${config.serverUrl.replace(/\/$/, "")}/api/v1/digital-assets/ugc/upload`, { method: "POST", headers: config.apiToken ? { Authorization: `Bearer ${config.apiToken}` } : {}, body: form, signal: AbortSignal.timeout(120_000) });
      if (!response.ok) return { type: "ugc_error", ok: false, detail: `Server returned ${response.status}` };
      const result = await response.json() as Record<string, unknown>; await unlink(request.file_path);
      return { type: "ugc_confirmed", ok: true, ...result, filename: result.filename ?? path.basename(request.file_path), size_bytes: result.size_bytes ?? data.length, customer_id: customerId };
    } catch (error) { return { type: "ugc_error", ok: false, detail: error instanceof Error ? error.message : String(error) }; }
  }
}
