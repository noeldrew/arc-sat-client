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
      launchApp(): Promise<boolean>;
      exportDiagnostics(): Promise<boolean>;
      updateConfig(config: import("../core/config").SatelliteConfig): Promise<import("../core/config").SatelliteConfig>;
      onStatus(listener: (value: import("../core/events").SatelliteStatus) => void): () => void;
      onActivity(listener: (value: import("../core/events").ActivityEntry) => void): () => void;
      onConfig(listener: (value: import("../core/config").SatelliteConfig) => void): () => void;
      onSystemStats(listener: (value: import("../core/system-monitor").SystemSnapshot) => void): () => void;
    };
  }
}
