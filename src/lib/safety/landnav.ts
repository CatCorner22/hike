import * as turf from "@turf/turf";
import { isValidCoordinate } from "@/lib/geo/coords";
import { magneticDeclination, toMagneticBearing } from "@/lib/safety/declination";

/** NATO mils: 6400 mils in a circle. */
export function degreesToMils(degrees: number): number | null {
  if (!Number.isFinite(degrees) || Math.abs(degrees) > 360) return null;
  // 359.99 deg rounds up to a whole circle; report it as north, not "6400 mils".
  return Math.round(((((degrees % 360) + 360) % 360) * 6400) / 360) % 6400;
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

/** Empty string must not become 0° north — Number("") is 0. */
export function parseTypedHeading(text: string): number | null {
  const typed = text.trim();
  if (!typed) return null;
  const n = Number(typed);
  if (!Number.isFinite(n)) return null;
  return ((n % 360) + 360) % 360;
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
  // turf walks straight past +/-180 rather than wrapping, so a leg that crosses the
  // antimeridian comes back as 180.019 and the on-globe validator threw it away —
  // dead reckoning returned null for every step across the seam, in the western
  // Aleutians, Fiji and the Chathams. Normalize the equivalent coordinate first, the
  // same way utmToLatLng already does for the inverse projection.
  const point = {
    lat: dest.geometry.coordinates[1],
    lng: ((dest.geometry.coordinates[0] + 180) % 360 + 360) % 360 - 180,
  };
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
 * Furthest a fix may sit from a known point before it is treated as a bad cut.
 * Two great circles always meet somewhere, so without this a pair of nonsense
 * bearings would return a confident position on the far side of the continent.
 */
const MAX_CUT_RANGE_M = 80_000;

type Vec3 = [number, number, number];

function toVec(lat: number, lng: number): Vec3 {
  const phi = (lat * Math.PI) / 180;
  const lam = (lng * Math.PI) / 180;
  const c = Math.cos(phi);
  return [c * Math.cos(lam), c * Math.sin(lam), Math.sin(phi)];
}

function vecToLatLng(v: Vec3): { lat: number; lng: number } {
  return {
    lat: (Math.atan2(v[2], Math.hypot(v[0], v[1])) * 180) / Math.PI,
    lng: (Math.atan2(v[1], v[0]) * 180) / Math.PI,
  };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function unit(v: Vec3): Vec3 | null {
  const m = Math.hypot(v[0], v[1], v[2]);
  if (!(m > 1e-12)) return null;
  return [v[0] / m, v[1] / m, v[2] / m];
}

/** Unit vector along `bearingDeg` in the tangent plane at (lat, lng). */
function headingVec(lat: number, lng: number, bearingDeg: number): Vec3 {
  const phi = (lat * Math.PI) / 180;
  const lam = (lng * Math.PI) / 180;
  const th = (bearingDeg * Math.PI) / 180;
  const sinPhi = Math.sin(phi);
  const cosTh = Math.cos(th);
  const sinTh = Math.sin(th);
  // north = d(position)/d(lat), east = d(position)/d(lng), both unit length.
  return [
    -sinPhi * Math.cos(lam) * cosTh - Math.sin(lam) * sinTh,
    -sinPhi * Math.sin(lam) * cosTh + Math.cos(lam) * sinTh,
    Math.cos(phi) * cosTh,
  ];
}

/**
 * Where two bearing rays actually cross, on the same sphere turf's own
 * bearing/destination/distance functions model.
 *
 * The rays used to be drawn as two-vertex GeoJSON lines and crossed with
 * turf.lineIntersect, which is a *planar* intersection of raw lng/lat degrees.
 * A ray built by turf.destination follows a great circle, and a great circle is
 * a curve in degree space, so the straight chord that lineIntersect actually
 * crossed did not carry the bearing that was shot. With perfect, error-free
 * bearings that put the fix 65 m out from 10 km known points at 37.7 N and
 * 328 m out from 20 km points at 61 N — and because the bias is identical for
 * every pair, the three-point spread stayed small and the readout called the
 * fix good. A lost party would have radioed that position to SAR.
 *
 * A great circle through P on bearing th is the plane whose normal is
 * P x heading, so the two circles meet at +/-(N1 x N2) — exact, not fitted.
 * `dot(candidate, heading) > 0` keeps the crossing that lies ahead of both
 * shooters rather than behind them.
 */
export function greatCircleFix(
  a: { lat: number; lng: number },
  bearingFromA: number,
  b: { lat: number; lng: number },
  bearingFromB: number,
  maxRangeM = MAX_CUT_RANGE_M,
): { lat: number; lng: number } | null {
  if (
    ![a.lat, a.lng, b.lat, b.lng, bearingFromA, bearingFromB].every((v) =>
      Number.isFinite(v),
    )
  ) {
    return null;
  }
  const va = toVec(a.lat, a.lng);
  const vb = toVec(b.lat, b.lng);
  const da = headingVec(a.lat, a.lng, bearingFromA);
  const db = headingVec(b.lat, b.lng, bearingFromB);
  const na = unit(cross(va, da));
  const nb = unit(cross(vb, db));
  if (!na || !nb) return null;
  // Near-parallel circles: the cut is unstable, so refuse it rather than
  // return a wildly placed point. ~0.01 deg of separation.
  const line = cross(na, nb);
  if (!(Math.hypot(line[0], line[1], line[2]) > 1.7e-4)) return null;
  const candidate = unit(line);
  if (!candidate) return null;

  const antipode: Vec3 = [-candidate[0], -candidate[1], -candidate[2]];
  for (const point of [candidate, antipode]) {
    // Along the circle from P, a point at angular distance s is
    // P*cos(s) + heading*sin(s), so dot(point, heading) = sin(s): positive
    // means the crossing is ahead of the shooter, negative means behind.
    if (!(dot(point, da) > 0) || !(dot(point, db) > 0)) continue;
    const fix = vecToLatLng(point);
    if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) return null;
    const fromA = turf.distance(turf.point([a.lng, a.lat]), turf.point([fix.lng, fix.lat]), {
      units: "meters",
    });
    const fromB = turf.distance(turf.point([b.lng, b.lat]), turf.point([fix.lng, fix.lat]), {
      units: "meters",
    });
    if (fromA > maxRangeM || fromB > maxRangeM) return null;
    return fix;
  }
  return null;
}

/**
 * One-sigma bearing error a handheld compass fix realistically carries: needle,
 * sighting, declination rounding and picking the known point off the map.
 */
export const COMPASS_SIGMA_DEG = 2;

/**
 * Rayleigh 95th percentile of a two-dimensional circular normal, 2.448 sigma.
 * A fix goes out as a search radius, so it is quoted at containment rather than
 * at one sigma — under-quoting sends searchers to the wrong side of a drainage.
 */
const CONTAINMENT_95 = 2.45;

/**
 * Radius that actually bounds a bearing fix, derived from the geometry that
 * produced it rather than from how well the cuts happen to agree.
 *
 * Each ray can be off sideways by range * sigma, and a shallow cut multiplies
 * that by 1/sin(cut). Two known points 8 km out give a ~950 m radius no matter
 * how tidy the plot looks — which is the number a party radioing a position
 * needs to hear. Monte Carlo over 500 fixes per case: this contains the truth
 * ~95% of the time even when the party shoots a sloppier 3 deg, and essentially
 * always at 2 deg.
 */
/** Ground distance, or null where `rangeAzimuth` cannot answer. */
function rangeMetres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number | null {
  return rangeAzimuth(a, b)?.meters ?? null;
}

export function fixUncertaintyM(
  rangeAM: number,
  rangeBM: number,
  cutDeg: number,
  compassSigmaDeg = COMPASS_SIGMA_DEG,
): number | null {
  if (![rangeAM, rangeBM, cutDeg, compassSigmaDeg].every((v) => Number.isFinite(v))) return null;
  if (rangeAM < 0 || rangeBM < 0) return null;
  const sin = Math.abs(Math.sin((cutDeg * Math.PI) / 180));
  // A cut this shallow puts the fix anywhere along the rays; refuse to quote one.
  if (!(sin > 1e-3)) return null;
  const sigma = (Math.abs(compassSigmaDeg) * Math.PI) / 180;
  return (CONTAINMENT_95 * Math.hypot(rangeAM * sigma, rangeBM * sigma)) / sin;
}

/**
 * Mean of a few nearby points, taken on the sphere rather than in raw degrees.
 *
 * An arithmetic mean of longitudes is wrong the moment the points straddle
 * +/-180: three pairwise cuts at -180.0000, +180.0000 and -180.0000 average to
 * **-60**, putting the fix 9 619 km away in the Atlantic — and the panel hands
 * that straight to `onGoto`. Averaging the unit vectors has no seam.
 */
function meanPoint(points: Array<{ lat: number; lng: number }>): { lat: number; lng: number } | null {
  if (points.length === 0) return null;
  let x = 0;
  let y = 0;
  let z = 0;
  for (const point of points) {
    const [px, py, pz] = toVec(point.lat, point.lng);
    x += px;
    y += py;
    z += pz;
  }
  const mean = unit([x, y, z]);
  // Only antipodal-ish inputs cancel to nothing, which cannot happen for cuts
  // that all passed the range cap.
  return mean ? vecToLatLng(mean) : null;
}

/** Shortest signed a - b, in (-180, 180]. */
function signedDelta(a: number, b: number): number {
  return ((((a - b) % 360) + 540) % 360) - 180;
}

function bearingBetween(from: { lat: number; lng: number }, to: { lat: number; lng: number }): number {
  return (turf.bearing(turf.point([from.lng, from.lat]), turf.point([to.lng, to.lat])) + 360) % 360;
}

/**
 * Resection fix that honours the bearings *as the party actually read them*.
 *
 * A resection bearing is measured at the unknown position, so `bearing + 180`
 * is only the true reverse azimuth on a flat sheet. On the globe the two ends
 * of a long line differ by the convergence of the meridians, and plotting the
 * naive back azimuth from the known point walks a slightly different great
 * circle. That leaves a bias of about range^2 * tan(latitude) / R — 12 m from
 * 10 km known points at 37.7 N, 114 m from 20 km points at 61 N — always in the
 * same direction, so averaging three cuts does not remove it.
 *
 * Each pass re-reads the bearings at the current fix and nudges the plotted ray
 * by however much they disagree with what was shot. The correction is
 * second-order, so this settles to millimetres in two passes; three is slack.
 */
function resectionFix(
  knownA: { lat: number; lng: number },
  bearingToA: number,
  knownB: { lat: number; lng: number },
  bearingToB: number,
): { lat: number; lng: number } | null {
  let rayA = backAzimuth(bearingToA);
  let rayB = backAzimuth(bearingToB);
  if (rayA == null || rayB == null) return null;
  let fix = greatCircleFix(knownA, rayA, knownB, rayB);
  if (!fix) return null;
  for (let pass = 0; pass < 3; pass++) {
    const errA = signedDelta(bearingToA, bearingBetween(fix, knownA));
    const errB = signedDelta(bearingToB, bearingBetween(fix, knownB));
    if (Math.abs(errA) < 1e-9 && Math.abs(errB) < 1e-9) break;
    rayA = (rayA + errA + 360) % 360;
    rayB = (rayB + errB + 360) % 360;
    const next = greatCircleFix(knownA, rayA, knownB, rayB);
    // A refinement that falls outside the cut range means the geometry was
    // marginal to begin with; keep the last fix that did resolve.
    if (!next) break;
    fix = next;
  }
  return fix;
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
): {
  point: { lat: number; lng: number };
  cutDeg: number;
  uncertaintyM: number | null;
  warning: string | null;
} | null {
  const point = resectionFix(knownA, bearingToA, knownB, bearingToB);
  if (!point) return null;
  const { lat, lng } = point;
  const cutDeg = smallestAngle(bearingToA, bearingToB);
  if (cutDeg == null) return null;
  const rangeA = rangeMetres(point, knownA);
  const rangeB = rangeMetres(point, knownB);
  const uncertaintyM =
    rangeA == null || rangeB == null ? null : fixUncertaintyM(rangeA, rangeB, cutDeg);
  const warning =
    cutDeg < 30 || cutDeg > 150
      ? "Poor cut — shoot points 30–150° apart for a stable fix."
      : null;
  return { point: { lat, lng }, cutDeg, uncertaintyM, warning };
}

export interface ResectionObservation {
  known: { lat: number; lng: number };
  bearingTo: number;
}

/**
 * Three-point resection — centroid of the pairwise cuts.
 *
 * `spreadM` is how well the three cuts agree, and that is all it is. It used to
 * be reported as the accuracy of the fix ("Fix spread ~37 m — typical compass
 * error"), which is the classic cocked-hat mistake: how tightly three rays
 * happen to close says almost nothing about how far the fix sits from the
 * truth. Shooting three points 8 km out with a 2 deg compass, the fix is a
 * median 310 m off — and one run in six lands more than three times its own
 * reported spread from the truth. Three bearings off by 0, +3 and -3 deg put
 * all three cuts on the same point 499 m from the party, spread 0.5 m, no
 * warning at all.
 *
 * So the spread is kept, but only as the blunder check it really is — a wide
 * one means a misidentified peak or a misread bearing. `uncertaintyM` is the
 * number that bounds the fix, and it comes from the ranges and cut angles.
 */
export function resection3(
  obs: [ResectionObservation, ResectionObservation, ResectionObservation],
): {
  point: { lat: number; lng: number };
  spreadM: number;
  uncertaintyM: number | null;
  warning: string | null;
} | null {
  const hits: Array<{ lat: number; lng: number }> = [];
  const pairs: Array<[number, number]> = [
    [0, 1],
    [0, 2],
    [1, 2],
  ];
  for (const [i, j] of pairs) {
    if (backAzimuth(obs[i].bearingTo) == null || backAzimuth(obs[j].bearingTo) == null) {
      return null;
    }
    const hit = resectionFix(obs[i].known, obs[i].bearingTo, obs[j].known, obs[j].bearingTo);
    if (hit) hits.push(hit);
  }
  if (hits.length === 0) return null;
  const point = meanPoint(hits);
  if (!point) return null;
  let spreadM = 0;
  for (const h of hits) {
    const range = rangeAzimuth(point, h);
    if (!range) return null;
    spreadM = Math.max(spreadM, range.meters);
  }

  // Best-conditioned pair bounds the fix: a third bearing can tighten it, never
  // loosen it, so quoting the best pair is honest without being alarmist.
  let uncertaintyM: number | null = null;
  for (const [i, j] of pairs) {
    const cut = smallestAngle(obs[i].bearingTo, obs[j].bearingTo);
    if (cut == null) continue;
    const rangeI = rangeMetres(point, obs[i].known);
    const rangeJ = rangeMetres(point, obs[j].known);
    if (rangeI == null || rangeJ == null) continue;
    const pairUncertainty = fixUncertaintyM(rangeI, rangeJ, cut);
    if (pairUncertainty == null) continue;
    uncertaintyM = uncertaintyM == null ? pairUncertainty : Math.min(uncertaintyM, pairUncertainty);
  }

  const cuts = pairs.map(([i, j]) => smallestAngle(obs[i].bearingTo, obs[j].bearingTo));
  const poor = cuts.some((c) => c == null || c < 30 || c > 150);
  const warning =
    spreadM > 80
      ? `Cuts disagree by ~${Math.round(spreadM)} m — one bearing or peak is wrong; re-shoot.`
      : poor
        ? "Poor triangle — spread known points around you."
        : null;
  return { point, spreadM, uncertaintyM, warning };
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
): {
  point: { lat: number; lng: number };
  cutDeg: number;
  uncertaintyM: number | null;
  warning: string | null;
} | null {
  const point = greatCircleFix(observerA, bearingFromA, observerB, bearingFromB);
  if (!point) return null;
  const { lat, lng } = point;
  // The warning below already says "as seen from the target", but the angle was
  // the difference of the bearings shot *at the observers*. Over a curved Earth
  // those are not the same: at 83 N with observers 79 km out, a true 90 deg cut
  // reported as 95.8 and a true 160 deg cut as 161.8. Small, but it can flip the
  // poor-cut warning either way near the threshold and skews the radius with it.
  const cutDeg = smallestAngle(bearingBetween(point, observerA), bearingBetween(point, observerB));
  if (cutDeg == null) return null;
  const rangeA = rangeMetres(observerA, point);
  const rangeB = rangeMetres(observerB, point);
  const uncertaintyM =
    rangeA == null || rangeB == null ? null : fixUncertaintyM(rangeA, rangeB, cutDeg);
  const warning =
    cutDeg < 30 || cutDeg > 150
      ? "Poor cut — observers should be 30–150° apart as seen from the target."
      : null;
  return { point: { lat, lng }, cutDeg, uncertaintyM, warning };
}

/** Growing error ring for GPS-denied dead reckon (pace + heading slop). */
export function deadReckonUncertaintyM(input: {
  lastAccuracyM?: number;
  distanceM: number;
  headingErrorDeg?: number;
}): number {
  const last = Number.isFinite(input.lastAccuracyM) ? (input.lastAccuracyM as number) : 15;
  const dist = Number.isFinite(input.distanceM) ? Math.max(0, input.distanceM) : 0;
  // tan() blows up at 90 deg and turns negative past it, so a wide heading error
  // would have *shrunk* the ring it is supposed to grow. Past 80 deg the heading
  // carries no information anyway; cap there rather than quote a bogus number.
  const raw = input.headingErrorDeg ?? 15;
  const clamped = Number.isFinite(raw) ? Math.min(Math.abs(raw), 80) : 15;
  const headingErr = (clamped * Math.PI) / 180;
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
  // A negative or non-finite offset is refused by the guard above, but zero still
  // reaches here — and zero is not an aim-off. The aim point IS the target, so
  // "when you hit the catching feature, turn left" sends the party off the point
  // they just arrived at.
  if (offsetM <= 0) {
    return {
      aim,
      headingTrue,
      catchTurn,
      label: `Aim ${Math.round(headingTrue)}° true straight at the point — no offset, so there is no side to turn toward on arrival.`,
    };
  }
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
