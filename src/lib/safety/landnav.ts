import * as turf from "@turf/turf";
import { isValidCoordinate } from "@/lib/geo/coords";
import { magneticDeclination, toMagneticBearing } from "@/lib/safety/declination";

/** NATO mils: 6400 mils in a circle. */
export function degreesToMils(degrees: number): number | null {
  if (!Number.isFinite(degrees) || Math.abs(degrees) > 360) return null;
  return Math.round(((((degrees % 360) + 360) % 360) * 6400) / 360);
}

export function milsToDegrees(mils: number): number | null {
  if (!Number.isFinite(mils) || Math.abs(mils) > 6400) return null;
  return (((mils % 6400) + 6400) % 6400) * (360 / 6400);
}

export function backAzimuth(degrees: number): number | null {
  if (!Number.isFinite(degrees) || Math.abs(degrees) > 360) return null;
  return (((degrees + 180) % 360) + 360) % 360;
}

export interface RangeAzimuth {
  meters: number;
  trueDeg: number;
  magneticDeg: number | null;
  mils: number;
  backTrueDeg: number;
  backMils: number;
}

export function rangeAzimuth(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): RangeAzimuth | null {
  if (!isValidCoordinate(from) || !isValidCoordinate(to)) return null;
  const meters = turf.distance(
    turf.point([from.lng, from.lat]),
    turf.point([to.lng, to.lat]),
    { units: "meters" },
  );
  const trueDeg = (turf.bearing(turf.point([from.lng, from.lat]), turf.point([to.lng, to.lat])) + 360) % 360;
  const dec = magneticDeclination(from.lat, from.lng);
  const magneticDeg = dec == null ? null : toMagneticBearing(trueDeg, dec);
  return {
    meters,
    trueDeg,
    magneticDeg,
    mils: degreesToMils(trueDeg)!,
    backTrueDeg: backAzimuth(trueDeg)!,
    backMils: degreesToMils(backAzimuth(trueDeg)!)!,
  };
}

export function deadReckon(
  start: { lat: number; lng: number },
  headingTrue: number,
  distanceM: number,
): { lat: number; lng: number } | null {
  if (
    !isValidCoordinate(start) ||
    !Number.isFinite(headingTrue) ||
    Math.abs(headingTrue) > 360 ||
    !Number.isFinite(distanceM) ||
    distanceM < 0 ||
    distanceM > 40_075_017
  ) return null;
  const dest = turf.destination(
    turf.point([start.lng, start.lat]),
    distanceM,
    headingTrue,
    { units: "meters" },
  );
  const point = { lat: dest.geometry.coordinates[1], lng: dest.geometry.coordinates[0] };
  return isValidCoordinate(point) ? point : null;
}

export type PaceTerrain = "flat" | "up" | "down" | "sand" | "snow" | "night" | "brush";

/** Extra paces per 100 m vs a flat 100 m calibration. */
export const PACE_FACTOR: Record<PaceTerrain, number> = {
  flat: 1,
  up: 1.15,
  down: 0.95,
  sand: 1.2,
  snow: 1.25,
  night: 1.1,
  brush: 1.2,
};

export function distanceFromPaces(
  paces: number,
  pacesPer100m: number,
  terrain: PaceTerrain = "flat",
): number {
  if (pacesPer100m <= 0) return 0;
  return (paces / (pacesPer100m * (PACE_FACTOR[terrain] ?? 1))) * 100;
}

/** Range to a landmark of known height using the NATO mil relation. */
export function milRelationRange(heightMeters: number, mils: number): number | null {
  if (!(heightMeters > 0) || !(mils > 0)) return null;
  return (heightMeters * 1000) / mils;
}

export function smallestAngle(a: number, b: number): number | null {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

/**
 * Two-point resection: you shoot true bearings TO two known points.
 * Plot the back azimuths; their cut is your position.
 */
export function resection(
  knownA: { lat: number; lng: number },
  bearingToA: number,
  knownB: { lat: number; lng: number },
  bearingToB: number,
): { point: { lat: number; lng: number }; cutDeg: number; warning: string | null } | null {
  const backA = backAzimuth(bearingToA);
  const backB = backAzimuth(bearingToB);
  if (backA == null || backB == null) return null;
  const rayA = turf.lineString([
    [knownA.lng, knownA.lat],
    turf.destination(turf.point([knownA.lng, knownA.lat]), 80, backA, {
      units: "kilometers",
    }).geometry.coordinates,
  ]);
  const rayB = turf.lineString([
    [knownB.lng, knownB.lat],
    turf.destination(turf.point([knownB.lng, knownB.lat]), 80, backB, {
      units: "kilometers",
    }).geometry.coordinates,
  ]);
  const hit = turf.lineIntersect(rayA, rayB).features[0];
  if (!hit || hit.geometry.type !== "Point") return null;
  const [lng, lat] = hit.geometry.coordinates;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const cutDeg = smallestAngle(bearingToA, bearingToB);
  if (cutDeg == null) return null;
  const warning =
    cutDeg < 30 || cutDeg > 150
      ? "Poor cut — shoot points 30–150° apart for a stable fix."
      : null;
  return { point: { lat, lng }, cutDeg, warning };
}

export interface ResectionObservation {
  known: { lat: number; lng: number };
  bearingTo: number;
}

function resectionRay(obs: ResectionObservation, km = 80): GeoJSON.Feature<GeoJSON.LineString> | null {
  const back = backAzimuth(obs.bearingTo);
  if (back == null) return null;
  return turf.lineString([
    [obs.known.lng, obs.known.lat],
    turf.destination(turf.point([obs.known.lng, obs.known.lat]), km, back, {
      units: "kilometers",
    }).geometry.coordinates,
  ]);
}

/** Three-point resection — centroid of pairwise cuts; reports spread as error hint. */
export function resection3(
  obs: [ResectionObservation, ResectionObservation, ResectionObservation],
): {
  point: { lat: number; lng: number };
  spreadM: number;
  warning: string | null;
} | null {
  const hits: Array<{ lat: number; lng: number }> = [];
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) {
      const a = resectionRay(obs[i]);
      const b = resectionRay(obs[j]);
      if (!a || !b) return null;
      const hit = turf.lineIntersect(a, b).features[0];
      if (hit?.geometry.type === "Point") {
        const [lng, lat] = hit.geometry.coordinates;
        if (Number.isFinite(lat) && Number.isFinite(lng)) hits.push({ lat, lng });
      }
    }
  }
  if (hits.length === 0) return null;
  const lng = hits.reduce((s, p) => s + p.lng, 0) / hits.length;
  const lat = hits.reduce((s, p) => s + p.lat, 0) / hits.length;
  let spreadM = 0;
  for (const h of hits) {
    const range = rangeAzimuth({ lat, lng }, h);
    if (!range) return null;
    spreadM = Math.max(spreadM, range.meters);
  }
  const cut12 = smallestAngle(obs[0].bearingTo, obs[1].bearingTo);
  const cut23 = smallestAngle(obs[1].bearingTo, obs[2].bearingTo);
  const cut31 = smallestAngle(obs[2].bearingTo, obs[0].bearingTo);
  const poor = [cut12, cut23, cut31].some((c) => c == null || c < 30 || c > 150);
  const warning =
    spreadM > 80
      ? `Cuts disagree by ~${Math.round(spreadM)} m — re-shoot bearings.`
      : poor
        ? "Poor triangle — spread known points around you."
        : spreadM > 25
          ? `Fix spread ~${Math.round(spreadM)} m — typical compass error.`
          : null;
  return { point: { lat, lng }, spreadM, warning };
}

/** Time · speed · distance — any one missing value from the other two. */
export function timeSpeedDistance(input: {
  distanceM?: number;
  speedKph?: number;
  minutes?: number;
}): { distanceM: number; speedKph: number; minutes: number } | null {
  // Only strictly positive values count as supplied — a zero must not be treated as
  // "given" by one branch and "missing" by the gate, which silently discarded a real input.
  const positive = (v: number | undefined) => (v != null && v > 0 ? v : null);
  const distanceM = positive(input.distanceM);
  const speedKph = positive(input.speedKph);
  const minutes = positive(input.minutes);

  if ([distanceM, speedKph, minutes].filter((v) => v != null).length < 2) return null;
  if (distanceM != null && speedKph != null) {
    return { distanceM, speedKph, minutes: (distanceM / 1000 / speedKph) * 60 };
  }
  if (distanceM != null && minutes != null) {
    return { distanceM, speedKph: distanceM / 1000 / (minutes / 60), minutes };
  }
  if (speedKph != null && minutes != null) {
    return { distanceM: speedKph * (minutes / 60) * 1000, speedKph, minutes };
  }
  return null;
}

/**
 * Intersection: two observers at known points shoot true bearings TO the same unknown.
 * The cut is the unknown (lost party, smoke, aircraft).
 */
export function intersection(
  observerA: { lat: number; lng: number },
  bearingFromA: number,
  observerB: { lat: number; lng: number },
  bearingFromB: number,
): { point: { lat: number; lng: number }; cutDeg: number; warning: string | null } | null {
  const rayA = turf.lineString([
    [observerA.lng, observerA.lat],
    turf.destination(turf.point([observerA.lng, observerA.lat]), 80, bearingFromA, {
      units: "kilometers",
    }).geometry.coordinates,
  ]);
  const rayB = turf.lineString([
    [observerB.lng, observerB.lat],
    turf.destination(turf.point([observerB.lng, observerB.lat]), 80, bearingFromB, {
      units: "kilometers",
    }).geometry.coordinates,
  ]);
  const hit = turf.lineIntersect(rayA, rayB).features[0];
  if (!hit || hit.geometry.type !== "Point") return null;
  const [lng, lat] = hit.geometry.coordinates;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const cutDeg = smallestAngle(bearingFromA, bearingFromB);
  if (cutDeg == null) return null;
  const warning =
    cutDeg < 30 || cutDeg > 150
      ? "Poor cut — observers should be 30–150° apart as seen from the target."
      : null;
  return { point: { lat, lng }, cutDeg, warning };
}

/** Growing error ring for GPS-denied dead reckon (pace + heading slop). */
export function deadReckonUncertaintyM(input: {
  lastAccuracyM?: number;
  distanceM: number;
  headingErrorDeg?: number;
}): number {
  const last = Number.isFinite(input.lastAccuracyM) ? (input.lastAccuracyM as number) : 15;
  const dist = Math.max(0, input.distanceM);
  const headingErr = ((input.headingErrorDeg ?? 15) * Math.PI) / 180;
  return last + dist * 0.1 + dist * Math.tan(headingErr);
}

export function formatTsd(tsd: { distanceM: number; speedKph: number; minutes: number }): string {
  if (
    !Number.isFinite(tsd.distanceM) || tsd.distanceM < 0 || tsd.distanceM > 40_075_017 ||
    !Number.isFinite(tsd.speedKph) || tsd.speedKph < 0 || tsd.speedKph > 300 ||
    !Number.isFinite(tsd.minutes) || tsd.minutes < 0 || tsd.minutes > 366 * 24 * 60
  ) return "—";
  return `${Math.round(tsd.distanceM)} m · ${tsd.speedKph.toFixed(1)} km/h · ${Math.round(tsd.minutes)} min`;
}

export function deliberateOffset(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  offsetM: number,
  side: "left" | "right",
): {
  aim: { lat: number; lng: number };
  headingTrue: number;
  catchTurn: "left" | "right";
  label: string;
} | null {
  const ra = rangeAzimuth(from, to);
  if (!ra || !Number.isFinite(offsetM) || offsetM < 0 || offsetM > 40_075_017) return null;
  const perp = (ra.trueDeg + (side === "right" ? 90 : 270)) % 360;
  const aim = deadReckon(to, perp, offsetM);
  if (!aim) return null;
  const returnRange = rangeAzimuth(from, aim);
  if (!returnRange) return null;
  const headingTrue = returnRange.trueDeg;
  const catchTurn = side === "right" ? "left" : "right";
  return {
    aim,
    headingTrue,
    catchTurn,
    label: `Aim ${Math.round(headingTrue)}° true, offset ${Math.round(offsetM)} m ${side}. When you hit the catching feature, turn ${catchTurn}.`,
  };
}

export function obstacleBox(
  start: { lat: number; lng: number },
  headingTrue: number,
  widthM: number,
  depthM: number,
  side: "left" | "right",
): {
  resume: { lat: number; lng: number };
  corners: Array<{ lat: number; lng: number }>;
  legs: Array<{ heading: number; meters: number }>;
} | null {
  if (
    !isValidCoordinate(start) ||
    !Number.isFinite(headingTrue) ||
    Math.abs(headingTrue) > 360 ||
    !Number.isFinite(widthM) || widthM < 0 || widthM > 40_075_017 ||
    !Number.isFinite(depthM) || depthM < 0 || depthM > 40_075_017
  ) return null;
  const right = side === "right";
  const legs = [
    { heading: (headingTrue + (right ? 90 : 270)) % 360, meters: widthM },
    { heading: headingTrue, meters: depthM },
    { heading: (headingTrue + (right ? 270 : 90)) % 360, meters: widthM },
    { heading: headingTrue, meters: 0 },
  ];
  const corners: Array<{ lat: number; lng: number }> = [];
  let here = start;
  for (const leg of legs.slice(0, 3)) {
    const next = deadReckon(here, leg.heading, leg.meters);
    if (!next) return null;
    here = next;
    corners.push(here);
  }
  return { resume: here, corners, legs };
}

/** Turn this many degrees toward the destination to cancel a known lateral error. */
export function courseCorrection(offCourseM: number, remainingM: number): number {
  if (!(remainingM > 0) || !Number.isFinite(offCourseM)) return 0;
  return (Math.atan2(offCourseM, remainingM) * 180) / Math.PI;
}

export function formatZulu(date = new Date()): string {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}Z ${date.getUTCDate()} ${monthCode(date.getUTCMonth())} ${date.getUTCFullYear()}`;
}

function monthCode(month: number) {
  return ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][
    month
  ];
}

export function formatRangeAzimuth(ra: RangeAzimuth | null): string {
  if (
    !ra ||
    !Number.isFinite(ra.meters) || !Number.isFinite(ra.trueDeg) ||
    !Number.isFinite(ra.mils) || !Number.isFinite(ra.backTrueDeg) ||
    (ra.magneticDeg != null && !Number.isFinite(ra.magneticDeg))
  ) return "—";
  const mag =
    ra.magneticDeg != null ? ` / ${Math.round(ra.magneticDeg)}° mag` : "";
  return `${Math.round(ra.meters)} m · ${Math.round(ra.trueDeg)}° true (${ra.mils} mils)${mag} · back ${Math.round(ra.backTrueDeg)}°`;
}
