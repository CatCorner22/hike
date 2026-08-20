import * as turf from "@turf/turf";
import { progressAlongTrail, type TrailProgress } from "@/lib/geo/navigation";

export interface TrackPoint {
  lat: number;
  lng: number;
}

export function reverseTrackLine(points: TrackPoint[]): GeoJSON.LineString | null {
  if (points.length < 2) return null;
  return {
    type: "LineString",
    coordinates: [...points].reverse().map((p) => [p.lng, p.lat]),
  };
}

export function backtrackProgress(here: TrackPoint, points: TrackPoint[]): TrailProgress | null {
  const line = reverseTrackLine(points);
  if (!line) return null;
  return progressAlongTrail(here, line);
}

export function stationaryMinutes(
  points: Array<TrackPoint & { recordedAt?: number | string }>,
  now = Date.now(),
  radiusM = 25,
): number {
  if (points.length < 2) return 0;
  const last = points[points.length - 1];
  const origin = turf.point([last.lng, last.lat]);
  let oldest = now;

  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    const dist = turf.distance(origin, turf.point([p.lng, p.lat]), { units: "meters" });
    if (dist > radiusM) break;
    const t =
      typeof p.recordedAt === "number"
        ? p.recordedAt
        : p.recordedAt
          ? Date.parse(p.recordedAt)
          : now;
    oldest = Math.min(oldest, t);
  }

  return Math.max(0, Math.round((now - oldest) / 60000));
}

export function rapidAscentWarning(
  points: Array<TrackPoint & { altitude?: number; recordedAt?: number | string }>,
  now = Date.now(),
): string | null {
  const recent = points.filter((p) => {
    if (p.altitude == null) return false;
    const t =
      typeof p.recordedAt === "number"
        ? p.recordedAt
        : p.recordedAt
          ? Date.parse(p.recordedAt)
          : now;
    return now - t <= 60 * 60 * 1000;
  });
  if (recent.length < 4) return null;
  const alts = recent.map((p) => p.altitude as number);
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
  const recent = points.filter((p) => {
    if (p.altitude == null) return false;
    const t =
      typeof p.recordedAt === "number"
        ? p.recordedAt
        : p.recordedAt
          ? Date.parse(p.recordedAt)
          : now;
    return now - t <= 60 * 60 * 1000;
  });
  if (recent.length < 2) return 0;
  const alts = recent.map((p) => p.altitude as number);
  return alts[alts.length - 1] - Math.min(...alts);
}
