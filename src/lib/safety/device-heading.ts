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
