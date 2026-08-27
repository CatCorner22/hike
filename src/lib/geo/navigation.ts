import * as turf from "@turf/turf";
import { bboxFromGeometry } from "@/lib/geo";
import { minimumLongitudeInterval } from "@/lib/geo/antimeridian";
import { isFinitePosition, isValidCoordinate } from "@/lib/geo/coords";

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Which way along the stored line the hiker is travelling.
 *
 * The stored direction is arbitrary — `stitchRelationWays` normalises every OSM relation
 * chain to run west->east — so it says nothing about which end anyone started from.
 */
export type TravelDirection = "forward" | "backward" | "unknown";

export interface TrailProgress {
  nearest: LatLng;
  offsetMeters: number;
  /** Distance along the stored line from coordinate 0. Not "distance you have walked". */
  traveledMeters: number;
  /** Distance to the end you are heading for; to the nearer end when direction is unknown. */
  remainingMeters: number;
  totalMeters: number;
  remainingElevationMeters: number;
  /** How `remainingMeters` was resolved, so the UI can label it honestly. */
  remainingDirection: TravelDirection;
  /** Compass heading back to the route, always 0..360. */
  bearingToTrail: number;
  /** False means imported or persisted route/position data was invalid. */
  valid: boolean;
}

export interface SnapHint {
  traveledMeters: number;
}

export function trailLengthMeters(
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString,
): number {
  if (!isValidGeometry(geometry)) return 0;
  if (geometry.type === "MultiLineString") {
    return geometry.coordinates.reduce((sum, coords) => {
      if (coords.length < 2) return sum;
      return sum + turf.length(turf.lineString(coords), { units: "meters" });
    }, 0);
  }
  return turf.length(turf.feature(geometry), { units: "meters" });
}

function isTravelDirection(value: unknown): value is TravelDirection {
  return value === "forward" || value === "backward" || value === "unknown";
}

function resolveHintAndDirection(
  hintOrDirection?: SnapHint | TravelDirection | null,
  maybeDirection?: TravelDirection,
): { hint: SnapHint | null; direction: TravelDirection } {
  if (isTravelDirection(hintOrDirection)) {
    return { hint: null, direction: hintOrDirection };
  }
  const hint =
    hintOrDirection && typeof hintOrDirection === "object" && Number.isFinite(hintOrDirection.traveledMeters)
      ? hintOrDirection
      : null;
  return { hint, direction: isTravelDirection(maybeDirection) ? maybeDirection : "forward" };
}

/**
 * Distance still to walk, given how far along the stored line the hiker is and which way
 * they are travelling. Walking against the stored direction, "total - traveled" counts
 * *up* as you approach your destination — it read 0.00 km at the trailhead and 5.28 km at
 * the far end, and fed turnaroundWarning, silencing the daylight warning at the start of
 * a long walk. With no direction established yet, the nearer end is the honest answer.
 *
 * Every code path that turns traveled metres into a "remaining" figure must go through
 * this — the fast progress cache re-derived it independently once and re-introduced the
 * backwards readout.
 */
export function resolveRemaining(
  traveledMeters: number,
  totalMeters: number,
  direction: TravelDirection,
): { remainingMeters: number; resolvedDirection: TravelDirection } {
  const toEnd = Math.max(totalMeters - traveledMeters, 0);
  const toStart = Math.max(traveledMeters, 0);
  const remainingMeters =
    direction === "backward" ? toStart : direction === "forward" ? toEnd : Math.min(toStart, toEnd);
  const resolvedDirection: TravelDirection =
    direction !== "unknown" ? direction : toStart <= toEnd ? "backward" : "forward";
  return { remainingMeters, resolvedDirection };
}

export interface RouteComponentRange {
  startMeters: number;
  endMeters: number;
}

/**
 * On a MultiLineString, remaining toward the end of the *active component* —
 * not the full route minus a global offset that spans an unrunnable gap.
 */
export function resolveComponentRemaining(
  traveledMeters: number,
  totalMeters: number,
  direction: TravelDirection,
  componentRanges: RouteComponentRange[],
  componentIndex: number,
): { remainingMeters: number; resolvedDirection: TravelDirection } {
  if (componentRanges.length <= 1) {
    return resolveRemaining(traveledMeters, totalMeters, direction);
  }
  const component = componentRanges[componentIndex] ?? componentRanges[0];
  const componentLength = Math.max(component.endMeters - component.startMeters, 0);
  const localTraveled = Math.max(
    0,
    Math.min(traveledMeters - component.startMeters, componentLength),
  );
  return resolveRemaining(localTraveled, componentLength, direction);
}

function componentRangesFromGeometry(
  geometry: GeoJSON.MultiLineString,
  cumulative?: number[],
): RouteComponentRange[] {
  const ranges: RouteComponentRange[] = [];
  let offset = 0;
  for (const coords of geometry.coordinates) {
    if (coords.length < 2) continue;
    const length = turf.length(turf.lineString(coords), { units: "meters" });
    ranges.push({ startMeters: offset, endMeters: offset + length });
    offset += length;
  }
  if (cumulative && cumulative.length >= 2 && ranges.length > 0) {
    return ranges.map((range, index) => {
      const startIdx = geometry.coordinates
        .slice(0, index)
        .reduce((sum, line) => sum + Math.max(line.length, 1), 0);
      const line = geometry.coordinates[index];
      return {
        startMeters: cumulative[startIdx] ?? range.startMeters,
        endMeters: cumulative[startIdx + line.length - 1] ?? range.endMeters,
      };
    });
  }
  return ranges;
}

function progressOnSegment(
  point: LatLng,
  coordinates: GeoJSON.Position[],
  elevationProfile: Array<{ distanceMeters: number; elevation: number }>,
  traveledOffsetMeters: number,
  totalMeters: number,
  direction: TravelDirection,
): TrailProgress {
  const lineFeature = turf.lineString(coordinates);
  const pt = turf.point([point.lng, point.lat]);
  const snapped = turf.nearestPointOnLine(lineFeature, pt, { units: "meters" });
  const nearest = {
    lng: snapped.geometry.coordinates[0],
    lat: snapped.geometry.coordinates[1],
  };
  const offsetMeters = snapped.properties.dist ?? Number.NaN;
  const segmentTraveled = snapped.properties.location ?? 0;
  const traveledMeters = Math.min(
    traveledOffsetMeters + segmentTraveled,
    totalMeters,
  );
  const { remainingMeters, resolvedDirection } = resolveRemaining(
    traveledMeters,
    totalMeters,
    direction,
  );

  return {
    nearest,
    offsetMeters,
    traveledMeters,
    remainingMeters,
    totalMeters,
    remainingDirection: direction,
    remainingElevationMeters: remainingElevationGain(
      elevationProfile,
      traveledMeters,
      resolvedDirection,
    ),
    // turf.bearing is -180..180; navigation UI consumes a compass heading.
    bearingToTrail: normalizeHeading(
      turf.bearing(pt, turf.point([nearest.lng, nearest.lat])),
    ) ?? 0,
    valid: true,
  };
}

function pickContinuous(candidates: TrailProgress[], hint?: SnapHint | null): TrailProgress {
  const ranked = [...candidates].sort((a, b) => a.offsetMeters - b.offsetMeters);
  const best = ranked[0];
  if (!hint || ranked.length === 1) return stabilizeLoop(best, hint);
  const near = ranked.filter((c) => c.offsetMeters <= best.offsetMeters + 25);
  const forward = near.filter((c) => hint.traveledMeters - c.traveledMeters < 150);
  const pool = forward.length ? forward : near;
  pool.sort(
    (a, b) =>
      Math.abs(a.traveledMeters - hint.traveledMeters) -
      Math.abs(b.traveledMeters - hint.traveledMeters),
  );
  return stabilizeLoop(pool[0], hint);
}

/** Window near the route end where a loop may snap back to coordinate 0. */
export function loopStabilizeThresholds(totalMeters: number): {
  nearEndMeters: number;
  startJumpMeters: number;
} {
  if (totalMeters < 200) return { nearEndMeters: 0, startJumpMeters: 0 };
  return {
    nearEndMeters: Math.min(200, Math.max(120, totalMeters * 0.08)),
    startJumpMeters: Math.min(120, Math.max(80, totalMeters * 0.06)),
  };
}

/** Keep a loop from snapping remaining-m back to the start vertex. */
export function stabilizeLoop(progress: TrailProgress, hint?: SnapHint | null): TrailProgress {
  if (!hint || !Number.isFinite(progress.traveledMeters)) return progress;
  const total = progress.totalMeters;
  const { nearEndMeters, startJumpMeters } = loopStabilizeThresholds(total);
  if (nearEndMeters <= 0) return progress;
  const jumpedToStart =
    hint.traveledMeters > total - nearEndMeters && progress.traveledMeters < startJumpMeters;
  if (!jumpedToStart) return progress;
  const direction = progress.remainingDirection ?? "forward";
  const { remainingMeters } = resolveRemaining(total, total, direction);
  return {
    ...progress,
    traveledMeters: total,
    remainingMeters,
  };
}

/**
 * Snap a point onto the route.
 *
 * The 4th argument is either a continuity `SnapHint` (Phase 3) or a `TravelDirection`
 * (remaining-m toward the end you are walking). Pass both as `(…, hint, direction)`
 * when you have them.
 */
export function progressAlongTrail(
  point: LatLng,
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString,
  elevationProfile: Array<{ distanceMeters: number; elevation: number }> = [],
  hintOrDirection?: SnapHint | TravelDirection | null,
  maybeDirection?: TravelDirection,
): TrailProgress {
  const { hint, direction } = resolveHintAndDirection(hintOrDirection, maybeDirection);
  if (!isValidLatLng(point) || !isValidGeometry(geometry)) {
    return emptyProgress(isValidLatLng(point) ? point : { lat: 0, lng: 0 }, 0, false);
  }
  const totalMeters = trailLengthMeters(geometry);

  if (geometry.type === "MultiLineString") {
    const candidates: TrailProgress[] = [];
    const componentRanges = componentRangesFromGeometry(geometry);
    let cumulative = 0;

    for (const coords of geometry.coordinates) {
      if (coords.length < 2 || !coords.every(isFinitePosition)) continue;
      candidates.push(
        progressOnSegment(
          point,
          coords,
          elevationProfile,
          cumulative,
          totalMeters,
          direction,
        ),
      );
      cumulative += turf.length(turf.lineString(coords), { units: "meters" });
    }

    if (candidates.length) {
      const picked = pickContinuous(candidates, hint);
      if (componentRanges.length <= 1) return picked;
      const componentIndex = componentRanges.findIndex(
        (range) =>
          picked.traveledMeters >= range.startMeters - 1 &&
          picked.traveledMeters <= range.endMeters + 1,
      );
      const activeIndex = componentIndex >= 0 ? componentIndex : 0;
      const { remainingMeters, resolvedDirection } = resolveComponentRemaining(
        picked.traveledMeters,
        totalMeters,
        direction,
        componentRanges,
        activeIndex,
      );
      return stabilizeLoop(
        {
          ...picked,
          remainingMeters,
          remainingDirection: direction,
          remainingElevationMeters: remainingElevationGain(
            elevationProfile,
            picked.traveledMeters,
            resolvedDirection,
          ),
        },
        hint,
      );
    }
    return emptyProgress(point, totalMeters);
  }

  const coords = geometry.coordinates;
  if (coords.length < 2) {
    return emptyProgress(point, totalMeters);
  }

  return stabilizeLoop(
    progressOnSegment(point, coords, elevationProfile, 0, totalMeters, direction),
    hint,
  );
}

/**
 * Establish which way along the stored line the hiker is moving, from their own track.
 *
 * Uses only the RECENT tail of the track — the last `windowMetres` of movement — never
 * the whole session. Comparing the newest point against the session's first breadcrumb
 * meant an out-and-back (the most common hike shape) read "forward" for the entire
 * return leg: after the turnaround, Remaining counted to the far end and *increased*
 * while the hiker walked home, and turnaroundWarning judged the wrong distance.
 *
 * Two snaps only — this runs on GPS cadence and `nearestPointOnLine` is not cheap on a
 * long route. Below `minAlongMetres` of along-line movement inside the window (standing
 * still, GPS jitter, or mid-turnaround) the answer is "unknown" rather than a guess.
 */
export function travelDirectionAlong(
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString,
  track: LatLng[],
  options: { minAlongMetres?: number; windowMetres?: number } = {},
): TravelDirection {
  const minAlongMetres = options.minAlongMetres ?? 40;
  const windowMetres = options.windowMetres ?? 150;
  if (!isValidGeometry(geometry)) return "unknown";
  const usable = track.filter(
    (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng),
  );
  if (usable.length < 2) return "unknown";

  // Walk backwards from the newest point until the window is covered, measuring hops in
  // metres (equirectangular is fine at these distances).
  let windowStart = usable.length - 1;
  let covered = 0;
  while (windowStart > 0 && covered < windowMetres) {
    const a = usable[windowStart - 1];
    const b = usable[windowStart];
    const mPerDegLng = 111_320 * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
    covered += Math.hypot((b.lat - a.lat) * 111_132, (b.lng - a.lng) * mPerDegLng);
    windowStart -= 1;
  }

  const from = usable[windowStart];
  const to = usable[usable.length - 1];
  const alongFrom = progressAlongTrail(from, geometry).traveledMeters;
  const alongTo = progressAlongTrail(to, geometry).traveledMeters;
  const delta = alongTo - alongFrom;
  if (!Number.isFinite(delta) || Math.abs(delta) < minAlongMetres) return "unknown";
  return delta > 0 ? "forward" : "backward";
}

function emptyProgress(point: LatLng, totalMeters: number, valid = true): TrailProgress {
  return {
    nearest: point,
    offsetMeters: Number.NaN,
    traveledMeters: 0,
    remainingMeters: Math.max(totalMeters, 0),
    totalMeters,
    remainingElevationMeters: 0,
    remainingDirection: "unknown",
    // No route position is known. A numeric bearing would tell a hiker to walk
    // somewhere despite invalid data, so consumers must see this as unavailable.
    bearingToTrail: Number.NaN,
    valid,
  };
}

/**
 * Climb still ahead, in the direction of travel. Walking back toward coordinate 0, the
 * climb ahead is what the stored profile records as descent, so the forward-only version
 * reported the wrong figure — and it feeds the Naismith estimate the daylight warning uses.
 */
export function remainingElevationGain(
  profile: Array<{ distanceMeters: number; elevation: number }>,
  traveledMeters: number,
  direction: TravelDirection = "forward",
): number {
  if (profile.length < 2) return 0;
  let gain = 0;

  if (direction === "backward") {
    for (let i = profile.length - 1; i >= 1; i--) {
      const prev = profile[i - 1];
      const curr = profile[i];
      if (prev.distanceMeters >= traveledMeters) continue;
      const startElev =
        curr.distanceMeters > traveledMeters
          ? interpolateElevation(prev, curr, traveledMeters)
          : curr.elevation;
      const diff = prev.elevation - startElev;
      if (diff > 0) gain += diff;
    }
    return gain;
  }

  for (let i = 1; i < profile.length; i++) {
    const prev = profile[i - 1];
    const curr = profile[i];
    if (curr.distanceMeters <= traveledMeters) continue;
    const startElev =
      prev.distanceMeters < traveledMeters
        ? interpolateElevation(prev, curr, traveledMeters)
        : prev.elevation;
    const diff = curr.elevation - startElev;
    if (diff > 0) gain += diff;
  }
  return gain;
}

function interpolateElevation(
  a: { distanceMeters: number; elevation: number },
  b: { distanceMeters: number; elevation: number },
  at: number,
): number {
  const span = b.distanceMeters - a.distanceMeters;
  if (span <= 0) return b.elevation;
  const t = (at - a.distanceMeters) / span;
  return a.elevation + (b.elevation - a.elevation) * t;
}

export function normalizeHeading(degrees: number): number | null {
  if (!Number.isFinite(degrees)) return null;
  return ((degrees % 360) + 360) % 360;
}

export function compassLabel(heading: number): string | null {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const normalized = normalizeHeading(heading);
  if (normalized == null) return null;
  const index = Math.round(normalized / 45) % 8;
  return dirs[index];
}

export function gpsAccuracyLabel(accuracyMeters?: number | null): string {
  if (
    accuracyMeters == null ||
    !Number.isFinite(accuracyMeters) ||
    // Zero is not a measurement. Both CoreLocation and the W3C Geolocation API
    // use a non-positive accuracy to mean "no valid estimate", and "±0 m (good)"
    // is the most confident thing this app can say — printed for the one value
    // that carries no confidence at all.
    accuracyMeters <= 0 ||
    accuracyMeters > 10_000
  ) return "GPS accuracy unknown";
  const meters = Math.round(accuracyMeters);
  if (accuracyMeters <= 8) return `GPS ±${meters} m (good)`;
  if (accuracyMeters <= 20) return `GPS ±${meters} m (fair)`;
  return `GPS ±${meters} m (poor — canyon/trees)`;
}

export function safeBbox(
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString,
  extra?: LatLng,
): [number, number, number, number] | null {
  if (!isValidGeometry(geometry) || (extra && !isValidLatLng(extra))) return null;
  if (!extra) return bboxFromGeometry(geometry, 0.004);
  const lines = geometry.type === "LineString" ? [geometry.coordinates] : geometry.coordinates;
  const longitudes: number[] = [extra.lng];
  const latitudes: number[] = [extra.lat];
  for (const line of lines) {
    for (const [lng, lat] of line) {
      longitudes.push(lng);
      latitudes.push(lat);
    }
  }
  const interval = minimumLongitudeInterval(longitudes);
  if (!interval) return null;
  return [
    interval.minLng - 0.004,
    Math.min(...latitudes) - 0.004,
    interval.maxLng + 0.004,
    Math.max(...latitudes) + 0.004,
  ];
}

function isValidLatLng(point: unknown): point is LatLng {
  return isValidCoordinate(point);
}

export function isValidGeometry(
  geometry: unknown,
): geometry is GeoJSON.LineString | GeoJSON.MultiLineString {
  if (!geometry || typeof geometry !== "object") return false;
  const g = geometry as GeoJSON.LineString | GeoJSON.MultiLineString;
  if (g.type === "LineString") {
    return (
      Array.isArray(g.coordinates) &&
      g.coordinates.length >= 2 &&
      g.coordinates.every(isFinitePosition)
    );
  }
  if (g.type === "MultiLineString") {
    return (
      Array.isArray(g.coordinates) &&
      g.coordinates.some(
        (line) => Array.isArray(line) && line.length >= 2 && line.every(isFinitePosition),
      )
    );
  }
  return false;
}
