import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import si from "systeminformation";
import { SatelliteEvents } from "../src/core/events";
import { NetworkDiagnostics } from "../src/core/network-diagnostics";
import { createTestConfig } from "../src/core/satellite-core";

vi.mock("systeminformation", () => ({
  default: { networkInterfaces: vi.fn() },
}));

describe("network diagnostics", () => {
  beforeEach(() => {
    vi.mocked(si.networkInterfaces).mockResolvedValue({
      iface: "en0", ifaceName: "Wi-Fi", type: "wireless", ip4: "192.0.2.2", speed: 1000,
    } as never);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("measures the ARC path and reports adapter link speed", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("{}"))
      .mockResolvedValueOnce(new Response("{}"))
      .mockResolvedValueOnce(new Response("{}"))
      .mockResolvedValueOnce(new Response(new Uint8Array(1024)))
      .mockResolvedValueOnce(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    const diagnostics = new NetworkDiagnostics(
      () => createTestConfig({ apiToken: "test-token", monitoring: { processes: [], cpuThreshold: 85, ramThreshold: 90, diskThreshold: 90, intervalSeconds: 15, networkLatencyThresholdMs: 10_000, networkDownloadMinimumMbps: 0, networkUploadMinimumMbps: 0 } }),
      new SatelliteEvents(),
    );

    const result = await diagnostics.run("manual");

    expect(result.status).toBe("good");
    expect(result).toMatchObject({ adapterName: "Wi-Fi", adapterType: "wireless", linkSpeedMbps: 1000 });
    expect(result.latencyMs).toBeTypeOf("number");
    expect(result.downloadMbps).toBeTypeOf("number");
    expect(result.uploadMbps).toBeTypeOf("number");
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: "Bearer test-token" });
    expect(diagnostics.getState().history).toHaveLength(1);
  });
});
