import { intersection, rangeAzimuth, type RangeAzimuth } from "@/lib/safety/landnav";

/**
 * Position from MORE than two sources — bearings from several observers, or
 * several reported party positions.
 *
 * The reason this exists rather than reusing `intersection` twice: two bearings
 * ALWAYS cross somewhere. A pair of rays cannot disagree, so a two-observer fix
 * carries no consistency check at all — a compass read 40 deg wrong still
 * produces a confident-looking point. Three or more CAN disagree, and that
 * disagreement is the only direct evidence a party has that one of their
 * bearings is bad. Surfacing the spread is the whole point; the plotted point
 * is the easy half.
 *
 * Every pairwise cut goes through the hardened `intersection`, so the
 * behind-the-observer rejection, near-parallel refusal, antimeridian handling
 * and range cap are inherited rather than re-derived here.
 */

export interface BearingObservation {
  /** Who shot it — shown in the readout so a bad bearing can be traced back. */
  label?: string;
  lat: number;
  lng: number;
  /** Degrees TRUE (not magnetic) from this observer to the target. */
  bearingTrue: number;
}

export interface MultiFixResult {
  point: { lat: number; lng: number };
  /** Observations that contributed at least one usable cut. */
  observationsUsed: number;
  /** Pairwise cuts that survived validation. */
  cuts: number;
  /** Pairs that produced no usable cut (parallel, behind an observer, out of range). */
  cutsRejected: number;
  /**
   * How far the individual cuts scatter around the plotted point, in metres.
   * null with a single cut — one pair cannot disagree with itself, which is
   * exactly the blind spot a third bearing removes.
   */
  spreadM: number | null;
  /** Worst-case radius from cut geometry alone (shallow cuts, long ranges). */
  geometryM: number | null;
  /** The radius to actually quote: the larger of spread and geometry. */
  radiusM: number | null;
  /** Shallowest/widest cut angle among the pairs used. */
  worstCutDeg: number | null;
  warnings: string[];
}

const MAX_OBSERVATIONS = 8;

type Vec3 = [number, number, number];

function toVec(lat: number, lng: number): Vec3 {
  const phi = (lat * Math.PI) / 180;
  const lam = (lng * Math.PI) / 180;
  const c = Math.cos(phi);
  return [c * Math.cos(lam), c * Math.sin(lam), Math.sin(phi)];
}

/**
 * Mean position as a unit vector rather than an average of latitude and
 * longitude: the naive mean puts the centre of two cuts either side of the
 * antimeridian halfway around the planet.
 */
function vectorMean(points: Array<{ lat: number; lng: number }>): { lat: number; lng: number } | null {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of points) {
    const v = toVec(p.lat, p.lng);
    x += v[0];
    y += v[1];
    z += v[2];
  }
  const norm = Math.hypot(x, y, z);
  // Antipodal cuts cancel to the origin and have no meaningful mean.
  if (!(norm > 1e-9)) return null;
  const lat = (Math.asin(z / norm) * 180) / Math.PI;
  const lng = (Math.atan2(y, x) * 180) / Math.PI;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function validObservation(o: BearingObservation): boolean {
  return (
    Number.isFinite(o.lat) &&
    Number.isFinite(o.lng) &&
    Number.isFinite(o.bearingTrue) &&
    Math.abs(o.lat) <= 90 &&
    Math.abs(o.lng) <= 180
  );
}

/**
 * Triangulate an unknown point (lost party, smoke, signal fire, aircraft) from
 * two or more observers who each shot a TRUE bearing to it.
 *
 * Returns null when nothing usable can be produced — never a guess.
 */
export function triangulateFromBearings(
  observations: BearingObservation[],
): MultiFixResult | null {
  if (!Array.isArray(observations)) return null;
  const usable = observations.filter(validObservation).slice(0, MAX_OBSERVATIONS);
  if (usable.length < 2) return null;

  const cuts: Array<{ lat: number; lng: number; cutDeg: number; uncertaintyM: number | null }> = [];
  const contributed = new Set<number>();
  let rejected = 0;

  for (let i = 0; i < usable.length; i += 1) {
    for (let j = i + 1; j < usable.length; j += 1) {
      const a = usable[i];
      const b = usable[j];
      const cut = intersection(
        { lat: a.lat, lng: a.lng },
        a.bearingTrue,
        { lat: b.lat, lng: b.lng },
        b.bearingTrue,
      );
      if (!cut) {
        rejected += 1;
        continue;
      }
      cuts.push({ ...cut.point, cutDeg: cut.cutDeg, uncertaintyM: cut.uncertaintyM });
      contributed.add(i);
      contributed.add(j);
    }
  }

  if (cuts.length === 0) return null;

  const point = vectorMean(cuts);
  if (!point) return null;

  // Spread: how far the individual cuts sit from the plotted point. With one
  // cut there is nothing to compare against, and saying "0 m spread" there
  // would read as perfect agreement when it is really no evidence at all.
  let spreadM: number | null = null;
  if (cuts.length > 1) {
    let worst = 0;
    for (const cut of cuts) {
      const ra = rangeAzimuth(point, { lat: cut.lat, lng: cut.lng });
      if (ra) worst = Math.max(worst, ra.meters);
    }
    spreadM = worst;
  }

  const geometryValues = cuts.map((c) => c.uncertaintyM).filter((v): v is number => v != null);
  // The WORST pair, not the best: a tight cut between two of the bearings does
  // not shrink the error a third, shallower one carries.
  const geometryM = geometryValues.length ? Math.max(...geometryValues) : null;

  const radiusM =
    spreadM != null && geometryM != null
      ? Math.max(spreadM, geometryM)
      : (geometryM ?? spreadM);

  const cutAngles = cuts.map((c) => c.cutDeg);
  // "Worst" is the one furthest from a square 90 deg cut, in either direction.
  const worstCutDeg = cutAngles.length
    ? cutAngles.reduce((worst, deg) => (Math.abs(deg - 90) > Math.abs(worst - 90) ? deg : worst), cutAngles[0])
    : null;

  const warnings: string[] = [];
  if (usable.length < 3) {
    warnings.push(
      "Two bearings always cross — this fix has no cross-check. A third bearing is what proves it.",
    );
  }
  if (spreadM != null && geometryM != null && spreadM > geometryM) {
    warnings.push(
      `Observers disagree by ${Math.round(spreadM)} m — more than the geometry explains. Re-shoot the bearings and check declination before trusting this point.`,
    );
  }
  if (worstCutDeg != null && (worstCutDeg < 30 || worstCutDeg > 150)) {
    warnings.push(
      `Shallow cut (${Math.round(worstCutDeg)}°) — observers should be 30–150° apart as seen from the target.`,
    );
  }
  if (rejected > 0) {
    warnings.push(
      `${rejected} bearing pair${rejected === 1 ? "" : "s"} produced no usable cut (parallel, out of range, or the target would be behind an observer).`,
    );
  }

  return {
    point,
    observationsUsed: contributed.size,
    cuts: cuts.length,
    cutsRejected: rejected,
    spreadM,
    geometryM,
    radiusM,
    worstCutDeg,
    warnings,
  };
}

export interface PartyMember {
  label: string;
  lat: number;
  lng: number;
  /** When their fix was taken, epoch ms. Unknown ages are stated, never assumed fresh. */
  atMs?: number | null;
  /** Provenance carried in from a scanned handoff ("DEAD RECKON — not live GPS"). */
  provenance?: string | null;
}

/**
 * Generic in the member type so callers keep their own fields (row ids, draft
 * input) on the way through — matching rows by index instead would attach one
 * person's bearing to another person's position whenever a member is filtered.
 */
export type PartyEntry<T extends PartyMember = PartyMember> = T & {
  /** From the reader to that member; null when the reader has no fix. */
  vector: RangeAzimuth | null;
  ageMinutes: number | null;
};

export interface PartyPicture<T extends PartyMember = PartyMember> {
  entries: PartyEntry<T>[];
  /** Mean of every member position (and the reader, when they have a fix). */
  centroid: { lat: number; lng: number } | null;
  /** Greatest separation between any two members, metres. */
  spreadM: number | null;
  warnings: string[];
}

/** Members further apart than this are not travelling together in any useful sense. */
const PARTY_SEPARATION_WARN_M = 500;

/**
 * The picture of where everyone is, built from positions scanned off other
 * phones (or typed in).
 *
 * Each member's fix is a SNAPSHOT from whenever their phone made it — it does
 * not track. Age is computed and surfaced for exactly that reason: a 40-minute
 * old position of a moving hiker is a starting point for a search, not a
 * location, and the caller must be able to say so.
 */
export function partyPicture<T extends PartyMember>(
  me: { lat: number; lng: number } | null,
  members: T[],
  nowMs = Date.now(),
): PartyPicture<T> {
  const valid = (members ?? []).filter(
    (m) =>
      Number.isFinite(m.lat) &&
      Number.isFinite(m.lng) &&
      Math.abs(m.lat) <= 90 &&
      Math.abs(m.lng) <= 180,
  );

  const entries: PartyEntry<T>[] = valid.map((m) => {
    const ageMinutes =
      m.atMs != null && Number.isFinite(m.atMs) && m.atMs <= nowMs
        ? Math.round((nowMs - m.atMs) / 60_000)
        : null;
    return {
      ...m,
      vector: me ? rangeAzimuth(me, { lat: m.lat, lng: m.lng }) : null,
      ageMinutes,
    };
  });

  const points = me ? [me, ...valid] : valid;
  const centroid = points.length ? vectorMean(points) : null;

  let spreadM: number | null = null;
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const ra = rangeAzimuth(points[i], points[j]);
      if (ra) spreadM = Math.max(spreadM ?? 0, ra.meters);
    }
  }

  const warnings: string[] = [];
  if (spreadM != null && spreadM > PARTY_SEPARATION_WARN_M) {
    warnings.push(
      `Party spread ${Math.round(spreadM)} m — regroup or agree a rally point before the light goes.`,
    );
  }
  const stale = entries.filter((e) => e.ageMinutes != null && e.ageMinutes >= 30);
  if (stale.length) {
    warnings.push(
      `${stale.length} position${stale.length === 1 ? " is" : "s are"} over 30 minutes old. These are snapshots, not tracking — a moving hiker is no longer there.`,
    );
  }
  const unknownAge = entries.filter((e) => e.ageMinutes == null);
  if (unknownAge.length) {
    warnings.push(
      `${unknownAge.length} position${unknownAge.length === 1 ? " has" : "s have"} no timestamp — treat the age as unknown, not recent.`,
    );
  }

  return { entries, centroid, spreadM, warnings };
}
