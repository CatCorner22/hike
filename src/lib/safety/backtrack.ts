import * as turf from "@turf/turf";
import { isValidCoordinate } from "@/lib/geo/coords";
import { progressAlongTrail, type TrailProgress } from "@/lib/geo/navigation";

export interface TrackPoint {
  lat: number;
  lng: number;
  recordedAt?: number | string;
}

/**
 * A pocketed phone, a suspended GPS watch or a dead battery leaves a hole in the
 * breadcrumb, and joining the two points either side of it draws a straight line
 * the hiker never walked — across a drainage, a cliff band, whatever they went
 * around. The app has no terrain data to tell them otherwise, and the line is
 * rendered as one unbroken dashed polyline, so there is no visual tell either.
 *
 * Two minutes is well beyond any normal sampling interval, and 250 m is further
 * than a walker covers in that time on any trail. Either alone is enough to
 * distrust the segment.
 */
export const BREADCRUMB_GAP_SECONDS = 120;
export const BREADCRUMB_GAP_METERS = 250;

function pointTimeMs(point: TrackPoint): number | null {
  if (point.recordedAt == null) return null;
  const ms = typeof point.recordedAt === "number" ? point.recordedAt : Date.parse(point.recordedAt);
  return Number.isFinite(ms) ? ms : null;
}

/** True when nothing was recorded between these two consecutive fixes. */
export function isBreadcrumbGap(a: TrackPoint, b: TrackPoint): boolean {
  if (!isValidCoordinate(a) || !isValidCoordinate(b)) return true;
  const meters = turf.distance(turf.point([a.lng, a.lat]), turf.point([b.lng, b.lat]), {
    units: "meters",
  });
  if (meters > BREADCRUMB_GAP_METERS) return true;
  const aMs = pointTimeMs(a);
  const bMs = pointTimeMs(b);
  if (aMs == null || bMs == null) return false;
  return Math.abs(bMs - aMs) > BREADCRUMB_GAP_SECONDS * 1000;
}

/**
 * The reversed track split at every gap. The first entry is the run leading back
 * from where the hiker is now — the only stretch a bearing can honestly be taken
 * along.
 */
export function reverseTrackSegments(points: TrackPoint[]): GeoJSON.LineString[] {
  const reversed = [...points].reverse();
  const segments: TrackPoint[][] = [];
  let current: TrackPoint[] = [];
  for (const point of reversed) {
    const previous = current[current.length - 1];
    if (previous && isBreadcrumbGap(previous, point)) {
      if (current.length >= 2) segments.push(current);
      current = [];
    }
    current.push(point);
  }
  if (current.length >= 2) segments.push(current);
  return segments.map((run) => ({
    type: "LineString",
    coordinates: run.map((p) => [p.lng, p.lat]),
  }));
}

export function reverseTrackLine(points: TrackPoint[]): GeoJSON.LineString | null {
  if (points.length < 2) return null;
  return {
    type: "LineString",
    coordinates: [...points].reverse().map((p) => [p.lng, p.lat]),
  };
}

export interface BacktrackResult {
  progress: TrailProgress | null;
  /**
   * Set when the retrace runs out at a recording gap. The distance and bearing
   * beyond it are not knowable, and a blank is honest where a confident number
   * is not.
   */
  gapAhead: { minutes: number | null; meters: number } | null;
}

export function backtrackProgress(here: TrackPoint, points: TrackPoint[]): TrailProgress | null {
  return backtrackAlongContiguousTrack(here, points).progress;
}

/**
 * Retrace guidance that stops at the first hole in the breadcrumb instead of
 * bridging it. `progressAlongTrail` used to be handed the whole reversed array,
 * so "Remaining" and "Est. time back" were computed along fabricated geometry
 * and the bearing pointed across ground nobody had walked.
 */
export function backtrackAlongContiguousTrack(
  here: TrackPoint,
  points: TrackPoint[],
): BacktrackResult {
  const segments = reverseTrackSegments(points);
  const contiguous = segments[0];
  if (!contiguous) return { progress: null, gapAhead: null };

  const progress = progressAlongTrail(here, contiguous);
  if (segments.length < 2) return { progress, gapAhead: null };

  // Where the usable run ends, and where the next one picks up.
  const end = contiguous.coordinates[contiguous.coordinates.length - 1];
  const resume = segments[1].coordinates[0];
  const meters = turf.distance(turf.point(end), turf.point(resume), { units: "meters" });

  const reversed = [...points].reverse();
  const endPoint = reversed.find((p) => p.lng === end[0] && p.lat === end[1]);
  const resumePoint = reversed.find((p) => p.lng === resume[0] && p.lat === resume[1]);
  const endMs = endPoint ? pointTimeMs(endPoint) : null;
  const resumeMs = resumePoint ? pointTimeMs(resumePoint) : null;
  const minutes =
    endMs != null && resumeMs != null ? Math.round(Math.abs(endMs - resumeMs) / 60_000) : null;

  return { progress, gapAhead: { minutes, meters: Math.round(meters) } };
}

export function stationaryMinutes(
  points: Array<TrackPoint & { recordedAt?: number | string }>,
  now = Date.now(),
  radiusM = 25,
): number {
  if (points.length < 2 || !Number.isFinite(now) || !Number.isFinite(radiusM) || radiusM < 0) return 0;
  const last = points[points.length - 1];
  if (!isValidCoordinate(last)) return 0;
  const origin = turf.point([last.lng, last.lat]);
  let oldest = now;

  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    if (!isValidCoordinate(p)) break;
    const dist = turf.distance(origin, turf.point([p.lng, p.lat]), { units: "meters" });
    if (dist > radiusM) break;
    // sampleTime guards Date.parse; this loop used to call it raw, so one
    // unparseable timestamp made `oldest` NaN and the whole result NaN — and a
    // NaN minute count compares false against every threshold, so the
    // not-moving warning silently stopped firing.
    const t = sampleTime(p, now);
    if (t == null || t > now + CLOCK_SKEW_TOLERANCE_MS) continue;
    oldest = Math.min(oldest, t);
  }

  return Math.max(0, Math.round((now - oldest) / 60000));
}

const HOUR_MS = 60 * 60 * 1000;
/** A device clock is never exactly right; anything beyond this is not "now". */
const CLOCK_SKEW_TOLERANCE_MS = 2 * 60 * 1000;

/**
 * When a track point was recorded, or null if that cannot be trusted.
 *
 * An unparseable timestamp used to fall back to `now`, which fabricates recency:
 * a corrupt sample was read as having happened this instant and counted inside
 * every window below.
 */
function sampleTime(
  p: { recordedAt?: number | string },
  fallback: number,
): number | null {
  if (typeof p.recordedAt === "number") return Number.isFinite(p.recordedAt) ? p.recordedAt : null;
  if (p.recordedAt) {
    const t = Date.parse(String(p.recordedAt));
    return Number.isFinite(t) ? t : null;
  }
  return fallback;
}

/**
 * Track points inside `[now - windowMs, now]`, oldest first.
 *
 * The window test used to be `now - t <= windowMs`, which is satisfied by *any*
 * future timestamp. A point dated 90 minutes ahead at 9 000 m therefore counted
 * as "the last hour" and produced "You gained ~7000 m in the last hour" — an
 * impossible rate, and the sort of false alarm that trains a party to disbelieve
 * the warning bar.
 */
function samplesInWindow<T extends { recordedAt?: number | string }>(
  points: T[],
  now: number,
  windowMs: number,
): T[] {
  if (!Number.isFinite(now)) return [];
  const usable: Array<{ point: T; time: number }> = [];
  for (const point of points) {
    const time = sampleTime(point, now);
    if (time == null) continue;
    if (time > now + CLOCK_SKEW_TOLERANCE_MS) continue;
    if (now - time > windowMs) continue;
    usable.push({ point, time });
  }
  return usable.sort((a, b) => a.time - b.time).map((entry) => entry.point);
}

/**
 * Altitudes of the points in the window, finite only.
 *
 * `altitude != null` lets NaN through, and one NaN poisons `Math.min`: a single
 * bad sample turned a real 900 m ascent into `NaN`, which silently **deleted**
 * the rapid-ascent warning and zeroed the altitude-illness exposure. Failing
 * quiet is the wrong direction here.
 */
function finiteAltitudes(
  points: Array<{ altitude?: number; recordedAt?: number | string }>,
  now: number,
): number[] {
  return samplesInWindow(points, now, HOUR_MS)
    .map((p) => p.altitude)
    .filter((altitude): altitude is number => Number.isFinite(altitude));
}

export function rapidAscentWarning(
  points: Array<TrackPoint & { altitude?: number; recordedAt?: number | string }>,
  now = Date.now(),
): string | null {
  const alts = finiteAltitudes(points, now);
  if (alts.length < 4) return null;
  const minAlt = Math.min(...alts);
  const end = alts[alts.length - 1];
  const gain = end - minAlt;
  if (end >= 2400 && gain >= 400) {
    return `You gained ~${Math.round(gain)} m in the last hour above 2,400 m. Slow down and watch for altitude illness.`;
  }
  return null;
}

export function gainLastHourM(
  points: Array<TrackPoint & { altitude?: number; recordedAt?: number | string }>,
  now = Date.now(),
): number {
  const alts = finiteAltitudes(points, now);
  if (alts.length < 2) return 0;
  return alts[alts.length - 1] - Math.min(...alts);
}
