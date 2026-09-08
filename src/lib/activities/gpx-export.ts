import { gpxFromTrack } from "@/lib/geo";
import { safeFilename } from "@/lib/safety/field";

export interface ActivityExportPoint {
  lat: number;
  lng: number;
  elevation?: number | null;
  recordedAt: Date | string;
}

export type ActivityGpxExportResult =
  | { ok: true; filename: string; gpx: string; pointCount: number }
  | { ok: false; status: 409 | 422; error: string };

/** Full-fidelity post-hike GPX. Refuses unfinished, empty, or corrupt tracks. */
export function buildActivityGpxExport(input: {
  name: string | null;
  endedAt: Date | string | null;
  points: ActivityExportPoint[];
}): ActivityGpxExportResult {
  if (input.endedAt == null || !Number.isFinite(new Date(input.endedAt).getTime())) {
    return { ok: false, status: 409, error: "Finish the activity before exporting its GPX track." };
  }
  if (input.points.length === 0) {
    return { ok: false, status: 422, error: "This finished activity has no GPS points to export." };
  }

  const points = input.points.map((point) => {
    const recordedAt = point.recordedAt instanceof Date ? point.recordedAt : new Date(point.recordedAt);
    if (
      !Number.isFinite(point.lat) || point.lat < -90 || point.lat > 90 ||
      !Number.isFinite(point.lng) || point.lng < -180 || point.lng > 180 ||
      (point.elevation != null && !Number.isFinite(point.elevation)) ||
      !Number.isFinite(recordedAt.getTime())
    ) return null;
    return { lat: point.lat, lng: point.lng, elevation: point.elevation, recordedAt };
  });
  if (points.some((point) => point === null)) {
    return {
      ok: false,
      status: 422,
      error: "The saved track contains an invalid GPS point. Nothing was omitted or exported.",
    };
  }

  const name = input.name?.trim() || "Trail activity";
  return {
    ok: true,
    filename: `${safeFilename(name)}-activity.gpx`,
    gpx: gpxFromTrack(name, points as NonNullable<(typeof points)[number]>[]),
    pointCount: points.length,
  };
}
