export {};

declare global {
  interface Window {
    arcSatellite: {
      platform: string;
      version: string;
    };
  }
}
