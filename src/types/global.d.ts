export {};

declare global {
  interface Window {
    arcSatellite: {
      platform: string;
      version: string;
      getStatus(): Promise<import("../core/events").SatelliteStatus>;
      getConfig(): Promise<import("../core/config").SatelliteConfig>;
      getBranding(): Promise<import("../core/branding").Branding>;
      getSystemStats(): Promise<import("../core/system-monitor").SystemSnapshot | undefined>;
      getNetworkTest(): Promise<import("../core/network-diagnostics").NetworkTestState>;
      runNetworkTest(): Promise<import("../core/network-diagnostics").NetworkTestResult>;
      cancelNetworkTest(): Promise<boolean>;
      getActivity(): Promise<import("../core/events").ActivityEntry[]>;
      openConsole(): Promise<void>;
      getPortConflict(): Promise<{ port: number; pid: number; command: string; user: string } | undefined>;
      recoverPort(pid: number): Promise<boolean>;
      launchApp(): Promise<boolean>;
      cancelLaunch(): Promise<boolean>;
      exportDiagnostics(): Promise<boolean>;
      exportTemplate(): Promise<boolean>;
      importTemplate(): Promise<import("../core/config").SatelliteConfig | undefined>;
      chooseApplication(): Promise<string | undefined>;
      detectProcess(selectedPath: string): Promise<string>;
      getZones(): Promise<{ available: boolean; zones: Array<{ id: string; name: string }>; reason?: string }>;
      getPathForFile(file: File): string;
      updateConfig(config: import("../core/config").SatelliteConfig): Promise<import("../core/config").SatelliteConfig>;
      onStatus(listener: (value: import("../core/events").SatelliteStatus) => void): () => void;
      onActivity(listener: (value: import("../core/events").ActivityEntry) => void): () => void;
      onConfig(listener: (value: import("../core/config").SatelliteConfig) => void): () => void;
      onSystemStats(listener: (value: import("../core/system-monitor").SystemSnapshot) => void): () => void;
      onNetworkTest(listener: (value: import("../core/network-diagnostics").NetworkTestState) => void): () => void;
      onLaunchScheduled(listener: (value: { reason: string; delaySeconds: number }) => void): () => void;
      onLaunchCancelled(listener: () => void): () => void;
    };
  }
}
