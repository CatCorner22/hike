import { normalizeHeading } from "@/lib/geo/navigation";

export type NavHeadingSource = "manual" | "compass" | "gps" | "none";

/** Parse a device-orientation event into true-north degrees, or null if unusable. */
export function headingFromOrientationEvent(
  event: DeviceOrientationEvent & { webkitCompassHeading?: number },
): number | null {
  if (
    typeof event.webkitCompassHeading === "number" &&
    Number.isFinite(event.webkitCompassHeading) &&
    event.webkitCompassHeading >= 0
  ) {
    return normalizeHeading(event.webkitCompassHeading);
  }
  if (event.absolute && event.alpha != null && Number.isFinite(event.alpha)) {
    // Portrait-held phone: alpha counts counter-clockwise from north.
    return normalizeHeading(360 - event.alpha);
  }
  return null;
}

/** Choose the heading the navigate HUD should display. */
export function fuseNavHeading(input: {
  manual?: number | null;
  device?: number | null;
  gps?: number | null;
  gpsDenied?: boolean;
}): { heading: number | null; source: NavHeadingSource } {
  if (input.gpsDenied && input.manual != null && Number.isFinite(input.manual)) {
    return { heading: normalizeHeading(input.manual), source: "manual" };
  }
  if (input.device != null && Number.isFinite(input.device)) {
    return { heading: normalizeHeading(input.device), source: "compass" };
  }
  if (input.gps != null && Number.isFinite(input.gps)) {
    return { heading: normalizeHeading(input.gps), source: "gps" };
  }
  if (input.manual != null && Number.isFinite(input.manual)) {
    return { heading: normalizeHeading(input.manual), source: "manual" };
  }
  return { heading: null, source: "none" };
}

/** Smallest angle between two headings (0–180°). */
export function headingAngularDifference(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  const na = normalizeHeading(a);
  const nb = normalizeHeading(b);
  if (na == null || nb == null) return 0;
  return Math.abs(((na - nb + 540) % 360) - 180);
}

const DEFAULT_HEADING_DISAGREEMENT_DEG = 45;

/** Warn when phone compass and GPS course diverge — common near metal, steep terrain, or slow travel. */
export function headingDisagreement(input: {
  compass?: number | null;
  gps?: number | null;
  thresholdDeg?: number;
}): { disagrees: boolean; deltaDeg: number | null; message: string | null } {
  const threshold = input.thresholdDeg ?? DEFAULT_HEADING_DISAGREEMENT_DEG;
  if (
    input.compass == null ||
    input.gps == null ||
    !Number.isFinite(input.compass) ||
    !Number.isFinite(input.gps)
  ) {
    return { disagrees: false, deltaDeg: null, message: null };
  }
  const delta = headingAngularDifference(input.compass, input.gps);
  if (delta <= threshold) {
    return { disagrees: false, deltaDeg: delta, message: null };
  }
  return {
    disagrees: true,
    deltaDeg: delta,
    message: `Compass and GPS course differ by ${Math.round(delta)}° — verify with map and terrain; calibrate compass away from metal.`,
  };
}

export function headingSourceLabel(source: NavHeadingSource): string {
  switch (source) {
    case "manual":
      return "Typed bearing";
    case "compass":
      return "Phone compass";
    case "gps":
      return "GPS course";
    default:
      return "Unavailable";
  }
}
