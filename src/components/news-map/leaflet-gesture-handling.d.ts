import "leaflet";

declare module "leaflet" {
  interface MapOptions {
    gestureHandling?: boolean;
    gestureHandlingOptions?: {
      text?: Record<string, string>;
      duration?: number;
    };
  }
}
