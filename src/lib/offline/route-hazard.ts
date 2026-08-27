import { haversineMeters as sharedHaversineMeters, isFinitePosition } from "@/lib/geo/coords";

export interface RouteSamplePoint {
  distanceMeters: number;
  lat: number;
  lng: number;
}

export interface HazardObservation {
  sampleDistanceMeters: number;
  kind: "weather" | "heat" | "cold" | "wind" | "lightning" | "smoke" | "closure" | "water" | "custom";
  severity: "info" | "watch" | "critical";
  title: string;
  detail?: string;
  observedAt?: string;
  source: string;
}

function haversineMeters(a: [number, number], b: [number, number]): number {
  return sharedHaversineMeters({ lat: a[1], lng: a[0] }, { lat: b[1], lng: b[0] });
}

/**
 * Route components, kept separate.
 *
 * A MultiLineString used to be flattened with `.flat()`, which joined
 * unconnected components into one path. Two 100 m components 157 km apart then
 * produced 32 sample points strung along a straight line across the gap, and
 * hazard observations were attached to positions the hiker will never walk
 * through -- while the real ones went unsampled.
 */
function components(geometry: GeoJSON.LineString | GeoJSON.MultiLineString): GeoJSON.Position[][] {
  const raw = geometry.type === "LineString" ? [geometry.coordinates] : geometry.coordinates;
  return raw
    .map((line) => (Array.isArray(line) ? line.filter(isFinitePosition) : []))
    .filter((line) => line.length >= 2);
}

/**
 * Samples by route distance, not by coordinate index, so dense GPX segments do not
 * accidentally dominate the briefing. Returned points are deterministic and offline-safe.
 */
/** Fallback used when the caller supplies an unusable interval. */
const DEFAULT_SAMPLE_INTERVAL_M = 5000;

export function sampleRouteByDistance(
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString,
  intervalMeters = DEFAULT_SAMPLE_INTERVAL_M,
): RouteSamplePoint[] {
  // Does not throw. This runs while building a pre-departure briefing, and an
  // exception there takes out the whole panel; sampling density is not a safety
  // claim, so an unusable interval falls back to the default instead.
  const interval =
    Number.isFinite(intervalMeters) && intervalMeters > 0
      ? intervalMeters
      : DEFAULT_SAMPLE_INTERVAL_M;
  if (!geometry || (geometry.type !== "LineString" && geometry.type !== "MultiLineString")) return [];

  const samples: RouteSamplePoint[] = [];
  let travelled = 0;

  // Each component is sampled on its own, so no sample point is ever placed
  // between two components.
  for (const coords of components(geometry)) {
    const cumulative = [0];
    for (let i = 1; i < coords.length; i += 1) {
      const step = haversineMeters(
        [coords[i - 1][0], coords[i - 1][1]],
        [coords[i][0], coords[i][1]],
      );
      cumulative.push(cumulative[i - 1] + (Number.isFinite(step) ? step : 0));
    }
    const total = cumulative.at(-1) ?? 0;

    const targets: number[] = [0];
    for (let d = interval; d < total; d += interval) targets.push(d);
    if (total > 0) targets.push(total);

    for (const target of targets) {
      let i = 1;
      while (i < cumulative.length && cumulative[i] < target) i += 1;
      const upper = Math.min(i, coords.length - 1);
      const prev = Math.max(0, upper - 1);
      const span = cumulative[upper] - cumulative[prev] || 1;
      const t = Math.min(1, Math.max(0, (target - cumulative[prev]) / span));
      const a = coords[prev];
      const b = coords[upper];
      const lng = a[0] + (b[0] - a[0]) * t;
      const lat = a[1] + (b[1] - a[1]) * t;
      // A sample the interpolation could not resolve is dropped rather than
      // emitted as NaN and later shown as a hazard location.
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      const distanceMeters = travelled + target;
      if (samples.some((existing) => existing.distanceMeters === distanceMeters)) continue;
      samples.push({ distanceMeters, lng, lat });
    }
    travelled += total;
  }

  return samples;
}

export function summarizeHazards(observations: HazardObservation[]): {
  critical: number;
  watch: number;
  info: number;
  unrecognised: number;
  highest: "critical" | "watch" | "info" | "none";
} {
  const counts = { critical: 0, watch: 0, info: 0, unrecognised: 0 };
  // `counts[observation.severity] += 1` wrote a junk key for any severity outside
  // the three expected values, so a hazard arriving from a feed as "CRITICAL"
  // was counted nowhere. Two mis-cased critical hazards -- a storm cell and a
  // trail closure -- summarised as highest: "none", telling the hiker the route
  // was clear. Unrecognised values are now counted and escalated, never dropped.
  for (const observation of Array.isArray(observations) ? observations : []) {
    const severity = observation?.severity;
    if (severity === "critical" || severity === "watch" || severity === "info") {
      counts[severity] += 1;
    } else {
      counts.unrecognised += 1;
    }
  }
  return {
    ...counts,
    highest: counts.critical
      ? "critical"
      : // An unreadable severity is treated as at least "watch": we know there is
        // a hazard, only not how bad it is.
        counts.watch || counts.unrecognised
        ? "watch"
        : counts.info
          ? "info"
          : "none",
  };
}
