import * as turf from "@turf/turf";

export function lineLengthMeters(
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString,
): number {
  const feature = turf.feature(geometry);
  return turf.length(feature, { units: "meters" });
}

export function distanceToTrailMeters(
  point: { lat: number; lng: number },
  trail: GeoJSON.LineString | GeoJSON.MultiLineString,
): number {
  const pt = turf.point([point.lng, point.lat]);
  const lineCoords =
    trail.type === "LineString"
      ? trail.coordinates
      : trail.coordinates.flat();
  const line = turf.lineString(lineCoords);
  return turf.pointToLineDistance(pt, line, { units: "meters" });
}

export function nearestPointOnTrail(
  point: { lat: number; lng: number },
  trail: GeoJSON.LineString | GeoJSON.MultiLineString,
): { lat: number; lng: number; distanceMeters: number; index: number } {
  const pt = turf.point([point.lng, point.lat]);
  const lineCoords =
    trail.type === "LineString"
      ? trail.coordinates
      : trail.coordinates.flat();
  const line = turf.lineString(lineCoords);
  const snapped = turf.nearestPointOnLine(line, pt, { units: "meters" });
  const coords = snapped.geometry.coordinates;

  return {
    lng: coords[0],
    lat: coords[1],
    distanceMeters: snapped.properties.dist ?? 0,
    index: snapped.properties.index ?? 0,
  };
}

export function computeTrackStats(
  coordinates: Array<{ lat: number; lng: number; elevation?: number | null }>,
): {
  distanceMeters: number;
  elevationGainMeters: number;
  durationSeconds: number;
  avgPaceMinPerKm: number;
} {
  if (coordinates.length < 2) {
    return {
      distanceMeters: 0,
      elevationGainMeters: 0,
      durationSeconds: 0,
      avgPaceMinPerKm: 0,
    };
  }

  let distanceMeters = 0;
  let elevationGainMeters = 0;

  for (let i = 1; i < coordinates.length; i++) {
    const prev = coordinates[i - 1];
    const curr = coordinates[i];
    distanceMeters += turf.distance(
      turf.point([prev.lng, prev.lat]),
      turf.point([curr.lng, curr.lat]),
      { units: "meters" },
    );

    if (
      prev.elevation != null &&
      curr.elevation != null &&
      curr.elevation > prev.elevation
    ) {
      elevationGainMeters += curr.elevation - prev.elevation;
    }
  }

  const startTime = coordinates[0].elevation;
  void startTime;

  return {
    distanceMeters,
    elevationGainMeters,
    durationSeconds: 0,
    avgPaceMinPerKm:
      distanceMeters > 0 ? (0 / (distanceMeters / 1000)) : 0,
  };
}

export function computeTrackStatsWithTime(
  points: Array<{
    lat: number;
    lng: number;
    elevation?: number | null;
    recordedAt: Date;
  }>,
) {
  const base = computeTrackStats(points);
  if (points.length < 2) return { ...base, durationSeconds: 0, avgPaceMinPerKm: 0 };

  const durationSeconds =
    (points[points.length - 1].recordedAt.getTime() -
      points[0].recordedAt.getTime()) /
    1000;

  const avgPaceMinPerKm =
    base.distanceMeters > 0
      ? durationSeconds / 60 / (base.distanceMeters / 1000)
      : 0;

  return {
    ...base,
    durationSeconds,
    avgPaceMinPerKm,
  };
}

export function coordsToLineString(
  coordinates: Array<{ lat: number; lng: number }>,
): GeoJSON.LineString {
  return {
    type: "LineString",
    coordinates: coordinates.map((c) => [c.lng, c.lat]),
  };
}

export function formatDistance(meters: number): string {
  const miles = meters / 1609.34;
  if (miles >= 0.1) return `${miles.toFixed(1)} mi`;
  return `${Math.round(meters)} m`;
}

export function formatElevation(meters: number): string {
  const feet = meters * 3.28084;
  return `${Math.round(feet).toLocaleString()} ft`;
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatPace(minPerKm: number): string {
  const minPerMile = minPerKm * 1.60934;
  const mins = Math.floor(minPerMile);
  const secs = Math.round((minPerMile - mins) * 60);
  return `${mins}:${secs.toString().padStart(2, "0")} /mi`;
}

export async function fetchElevationProfile(
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString,
  samples: number = 50,
): Promise<Array<{ distanceMeters: number; elevation: number }>> {
  const line = turf.lineString(
    geometry.type === "LineString"
      ? geometry.coordinates
      : geometry.coordinates.flat(),
  );
  const length = turf.length(line, { units: "meters" });
  const points: Array<{ lat: number; lng: number }> = [];

  for (let i = 0; i <= samples; i++) {
    const dist = (length * i) / samples;
    const pt = turf.along(line, dist, { units: "meters" });
    points.push({ lat: pt.geometry.coordinates[1], lng: pt.geometry.coordinates[0] });
  }

  try {
    const response = await fetch("https://api.open-elevation.com/api/v1/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        locations: points.map((p) => ({ latitude: p.lat, longitude: p.lng })),
      }),
      next: { revalidate: 86400 },
    });
    if (!response.ok) return [];
    const data = await response.json();
    return (data.results || []).map(
      (r: { elevation: number }, i: number) => ({
        distanceMeters: (length * i) / samples,
        elevation: r.elevation,
      }),
    );
  } catch {
    return [];
  }
}

export function computeElevationGain(
  profile: Array<{ elevation: number }>,
): number {
  let gain = 0;
  for (let i = 1; i < profile.length; i++) {
    const diff = profile[i].elevation - profile[i - 1].elevation;
    if (diff > 0) gain += diff;
  }
  return gain;
}

export function bearingBetween(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): number {
  return turf.bearing(turf.point([from.lng, from.lat]), turf.point([to.lng, to.lat]));
}

export function gpxFromLineString(
  name: string,
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString,
): string {
  const coords =
    geometry.type === "LineString"
      ? geometry.coordinates
      : geometry.coordinates.flat();

  const trkpts = coords
    .map(
      ([lng, lat]) =>
        `      <trkpt lat="${lat}" lon="${lng}"></trkpt>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Hike App">
  <trk>
    <name>${escapeXml(name)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}

export function gpxFromTrack(
  name: string,
  points: Array<{ lat: number; lng: number; elevation?: number | null; recordedAt?: Date }>,
): string {
  const trkpts = points
    .map((p) => {
      const ele = p.elevation != null ? `\n        <ele>${p.elevation}</ele>` : "";
      const time = p.recordedAt
        ? `\n        <time>${p.recordedAt.toISOString()}</time>`
        : "";
      return `      <trkpt lat="${p.lat}" lon="${p.lng}">${ele}${time}\n      </trkpt>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Hike App">
  <trk>
    <name>${escapeXml(name)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function parseGpx(gpxContent: string): GeoJSON.LineString | null {
  const trkptRegex = /<trkpt[^>]*lat="([^"]+)"[^>]*lon="([^"]+)"[^>]*>/g;
  const coordinates: GeoJSON.Position[] = [];
  let match;

  while ((match = trkptRegex.exec(gpxContent)) !== null) {
    coordinates.push([parseFloat(match[2]), parseFloat(match[1])]);
  }

  if (coordinates.length < 2) return null;
  return { type: "LineString", coordinates };
}

export function bboxFromGeometry(
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString,
  padding = 0.01,
): [number, number, number, number] {
  const coords =
    geometry.type === "LineString"
      ? geometry.coordinates
      : geometry.coordinates.flat();

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  for (const [lng, lat] of coords) {
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  }

  return [
    minLng - padding,
    minLat - padding,
    maxLng + padding,
    maxLat + padding,
  ];
}
