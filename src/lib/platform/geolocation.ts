import { getPlatformAdapters } from "@/lib/platform/adapters";

/**
 * Continuous position watch, through the platform seam.
 *
 * Web fallback is `navigator.geolocation.watchPosition` with the caller's own
 * options — exactly what the call sites did before the seam. The Capacitor
 * shell registers a GeolocationAdapter backed by a native CLLocationManager
 * watcher, which is the only way fixes keep arriving with the screen locked:
 * the W3C watch dies on suspend, which is why screen-locked track recording
 * has never worked as a web app on iOS.
 *
 * `background: true` requests locked-screen delivery (track recording).
 * The web path cannot honor it; recording under the web fallback remains
 * foreground-only and the wake lock is what keeps it alive.
 *
 * Callbacks receive GeolocationPosition/GeolocationPositionError-shaped
 * objects in both paths, so every downstream watchdog, stale check, and trust
 * rule runs unchanged.
 */
export function startGeoWatch(
  onFix: (position: GeolocationPosition) => void,
  onError: (error: GeolocationPositionError) => void,
  options: { background: boolean } & PositionOptions,
): () => void {
  const adapter = getPlatformAdapters().geolocation;
  if (adapter) {
    const watcher = adapter.watch(onFix, onError, { background: options.background });
    return () => watcher.stop();
  }
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
    queueMicrotask(() =>
      onError({
        code: 2,
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
        message: "Geolocation is unavailable in this browser",
      } as GeolocationPositionError),
    );
    return () => undefined;
  }
  const watchId = navigator.geolocation.watchPosition(onFix, onError, {
    enableHighAccuracy: options.enableHighAccuracy,
    maximumAge: options.maximumAge,
    timeout: options.timeout,
  });
  return () => navigator.geolocation.clearWatch(watchId);
}
