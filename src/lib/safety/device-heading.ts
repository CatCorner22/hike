import { normalizeHeading } from "@/lib/geo/navigation";
import { toTrueBearing } from "@/lib/safety/declination";

export type NavHeadingSource = "manual" | "compass" | "gps" | "none";

export type DeviceMagneticHeadingSource = "ios-webkit" | "w3c-absolute";

/**
 * A raw phone-magnetometer reading. Keeping the datum in the value prevents a
 * caller from accidentally feeding magnetic degrees into true-north navigation.
 */
export interface DeviceMagneticHeading {
  degrees: number;
  datum: "magnetic";
  source: DeviceMagneticHeadingSource;
}

export interface DeviceOrientationHeadingContext {
  /** Current magnetic declination, east-positive. Null means conversion is unavailable. */
  declinationDeg: number | null | undefined;
  /** Screen rotation in degrees. Only portrait-primary (0°) is currently supported. */
  screenOrientationDeg: number | null | undefined;
}

export interface DeviceHeadingReadingState {
  headingTrue: number | null;
  live: boolean;
  message: string | null;
}

export function unavailableDeviceHeadingState(
  message: string | null,
): DeviceHeadingReadingState {
  return { headingTrue: null, live: false, message };
}

const MAX_FLAT_TILT_DEG = 10;

function isFlatPortrait(
  event: DeviceOrientationEvent,
  screenOrientationDeg: number | null | undefined,
): boolean {
  if (
    screenOrientationDeg == null ||
    !Number.isFinite(screenOrientationDeg) ||
    normalizeHeading(screenOrientationDeg) !== 0
  ) {
    return false;
  }
  if (
    event.beta == null ||
    event.gamma == null ||
    !Number.isFinite(event.beta) ||
    !Number.isFinite(event.gamma)
  ) {
    return false;
  }
  return Math.abs(event.beta) <= MAX_FLAT_TILT_DEG && Math.abs(event.gamma) <= MAX_FLAT_TILT_DEG;
}

/**
 * Parse the two browser orientation APIs into an explicitly magnetic reading.
 *
 * Both iOS `webkitCompassHeading` and absolute device-orientation alpha are
 * treated as magnetic. We currently accept only a flat phone in portrait-primary
 * orientation; landscape/tilted transforms vary by browser and are safer to mark
 * unavailable than to guess.
 */
export function magneticHeadingFromOrientationEvent(
  event: DeviceOrientationEvent & { webkitCompassHeading?: number },
  screenOrientationDeg: number | null | undefined,
): DeviceMagneticHeading | null {
  if (!isFlatPortrait(event, screenOrientationDeg)) return null;

  if (
    typeof event.webkitCompassHeading === "number" &&
    Number.isFinite(event.webkitCompassHeading) &&
    event.webkitCompassHeading >= 0 &&
    event.webkitCompassHeading <= 360
  ) {
    const degrees = normalizeHeading(event.webkitCompassHeading);
    return degrees == null ? null : { degrees, datum: "magnetic", source: "ios-webkit" };
  }
  if (event.absolute && event.alpha != null && Number.isFinite(event.alpha)) {
    // Flat, portrait-primary phone: alpha counts counter-clockwise from magnetic north.
    const degrees = normalizeHeading(360 - event.alpha);
    return degrees == null ? null : { degrees, datum: "magnetic", source: "w3c-absolute" };
  }
  return null;
}

/** Convert a typed magnetic device reading to true north exactly once. */
export function deviceMagneticToTrueHeading(
  reading: DeviceMagneticHeading,
  declinationDeg: number | null | undefined,
): number | null {
  if (
    declinationDeg == null ||
    !Number.isFinite(declinationDeg) ||
    Math.abs(declinationDeg) > 90
  ) {
    return null;
  }
  return normalizeHeading(toTrueBearing(reading.degrees, declinationDeg));
}

/** Parse a device-orientation event into true-north degrees, or null if unusable. */
export function headingFromOrientationEvent(
  event: DeviceOrientationEvent & { webkitCompassHeading?: number },
  context: DeviceOrientationHeadingContext,
): number | null {
  const magnetic = magneticHeadingFromOrientationEvent(event, context.screenOrientationDeg);
  return magnetic == null
    ? null
    : deviceMagneticToTrueHeading(magnetic, context.declinationDeg);
}

/**
 * Apply one browser orientation sample without letting the relative event stream
 * erase a valid absolute compass reading. Some browsers dispatch both
 * `deviceorientationabsolute` and `deviceorientation`; the latter has
 * `absolute === false` and is not a magnetic-north measurement.
 *
 * Missing conversion prerequisites and malformed absolute samples still clear
 * the reading so callers never retain a heading they can no longer verify.
 */
export function reduceDeviceOrientationHeadingSample(
  current: DeviceHeadingReadingState,
  event: DeviceOrientationEvent & { webkitCompassHeading?: number },
  context: DeviceOrientationHeadingContext,
): DeviceHeadingReadingState {
  if (
    context.declinationDeg == null ||
    !Number.isFinite(context.declinationDeg) ||
    Math.abs(context.declinationDeg) > 90
  ) {
    return unavailableDeviceHeadingState(
      "Phone compass cannot be converted to true north here — using GPS course when moving.",
    );
  }

  const headingTrue = headingFromOrientationEvent(event, context);
  if (headingTrue != null) {
    return { headingTrue, live: true, message: null };
  }

  const hasAbsoluteSource =
    event.absolute === true || typeof event.webkitCompassHeading === "number";
  if (!hasAbsoluteSource) return current;

  return unavailableDeviceHeadingState(
    "Hold the phone flat in portrait to use its compass safely.",
  );
}

/** Choose a true-north heading for the navigate HUD. GPS course is already true north. */
export function fuseNavHeading(input: {
  manualTrue?: number | null;
  deviceTrue?: number | null;
  gpsCourseTrue?: number | null;
  gpsDenied?: boolean;
}): { headingTrue: number | null; source: NavHeadingSource } {
  if (input.gpsDenied && input.manualTrue != null && Number.isFinite(input.manualTrue)) {
    return { headingTrue: normalizeHeading(input.manualTrue), source: "manual" };
  }
  if (input.deviceTrue != null && Number.isFinite(input.deviceTrue)) {
    return { headingTrue: normalizeHeading(input.deviceTrue), source: "compass" };
  }
  if (input.gpsCourseTrue != null && Number.isFinite(input.gpsCourseTrue)) {
    return { headingTrue: normalizeHeading(input.gpsCourseTrue), source: "gps" };
  }
  if (input.manualTrue != null && Number.isFinite(input.manualTrue)) {
    return { headingTrue: normalizeHeading(input.manualTrue), source: "manual" };
  }
  return { headingTrue: null, source: "none" };
}

/** Smallest angle between two headings (0–180°). */
export function headingAngularDifference(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  const na = normalizeHeading(a);
  const nb = normalizeHeading(b);
  if (na == null || nb == null) return 0;
  return Math.abs(((na - nb + 540) % 360) - 180);
}

/**
 * How far the phone's compass and the GPS course may differ before the app says
 * so.
 *
 * It was 45 degrees, which is a quadrant. The failure this gate exists to catch
 * is a declination sign error — reading east as west, or a compass held near a
 * belt buckle — and a sign error over the western United States produces a
 * discrepancy of roughly 12 to 27 degrees. Every one of those passed silently
 * under a 45-degree threshold, which is to say the gate did not catch the thing
 * it was built for.
 *
 * Twenty degrees sits above the honest sources of disagreement — GPS course
 * noise at walking pace, and this app's own two-degree declination model — and
 * below the smallest sign error the terrain can produce.
 */
const DEFAULT_HEADING_DISAGREEMENT_DEG = 20;

/** Warn when phone compass and GPS course diverge — common near metal, steep terrain, or slow travel. */
export function headingDisagreement(input: {
  compassTrue?: number | null;
  gpsCourseTrue?: number | null;
  thresholdDeg?: number;
}): { disagrees: boolean; deltaDeg: number | null; message: string | null } {
  const threshold = input.thresholdDeg ?? DEFAULT_HEADING_DISAGREEMENT_DEG;
  if (
    input.compassTrue == null ||
    input.gpsCourseTrue == null ||
    !Number.isFinite(input.compassTrue) ||
    !Number.isFinite(input.gpsCourseTrue)
  ) {
    return { disagrees: false, deltaDeg: null, message: null };
  }
  const delta = headingAngularDifference(input.compassTrue, input.gpsCourseTrue);
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
      return "Typed true bearing";
    case "compass":
      return "Phone compass · true";
    case "gps":
      return "GPS course · true";
    default:
      return "Unavailable";
  }
}
