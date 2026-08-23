import { getPlatformAdapters } from "@/lib/platform/adapters";

/**
 * Device compass heading, through the platform seam.
 *
 * The web has no reliable heading source this app can use: iOS Safari's
 * `deviceorientation` needs a permission prompt per session, drifts, and reports
 * webkit-prefixed compass values inconsistently — so with no adapter registered this
 * seam reports unsupported and the app keeps today's behavior (GPS course while
 * moving, nothing at rest). The Capacitor shell registers a HeadingAdapter backed by
 * CLLocationManager heading updates, which closes the "which way am I facing while
 * standing still" gap. CLHeading's trueHeading is declination-corrected by the OS; a
 * negative trueHeading means "unknown", and callers fall back to magneticHeading plus
 * the app's own declination model.
 */
export interface HeadingSample {
  /** Degrees [0, 360), true north; null when the platform could not correct it. */
  trueHeading: number | null;
  /** Degrees [0, 360), magnetic north. */
  magneticHeading: number;
  /** Reported accuracy in degrees; larger is worse. Negative means invalid. */
  accuracyDeg: number;
  atMs: number;
}

export interface HeadingAdapter {
  subscribe(onSample: (sample: HeadingSample) => void): () => void;
}

export function isHeadingSupported(): boolean {
  return Boolean(getPlatformAdapters().heading);
}

/**
 * Subscribe to heading samples. Invalid samples are filtered here — one contract for
 * every consumer: headings normalized to [0, 360), non-finite and negative-accuracy
 * samples dropped, negative trueHeading mapped to null.
 */
export function subscribeHeading(onSample: (sample: HeadingSample) => void): () => void {
  const adapter = getPlatformAdapters().heading;
  if (!adapter) return () => undefined;
  return adapter.subscribe((raw) => {
    if (!Number.isFinite(raw.magneticHeading) || !Number.isFinite(raw.accuracyDeg)) return;
    if (raw.accuracyDeg < 0) return;
    const normalize = (deg: number) => ((deg % 360) + 360) % 360;
    onSample({
      magneticHeading: normalize(raw.magneticHeading),
      trueHeading:
        raw.trueHeading != null && Number.isFinite(raw.trueHeading) && raw.trueHeading >= 0
          ? normalize(raw.trueHeading)
          : null,
      accuracyDeg: raw.accuracyDeg,
      atMs: Number.isFinite(raw.atMs) ? raw.atMs : Date.now(),
    });
  });
}
