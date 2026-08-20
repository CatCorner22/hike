import * as turf from "@turf/turf";

function geometrySegments(
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString,
): GeoJSON.Position[][] {
  if (geometry.type === "LineString") return [geometry.coordinates];
  return geometry.coordinates.filter((line) => line.length >= 2);
}

export function lineLengthMeters(
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString,
): number {
  return geometrySegments(geometry).reduce((sum, coords) => {
    if (coords.length < 2) return sum;
    return sum + turf.length(turf.lineString(coords), { units: "meters" });
  }, 0);
}

export function distanceToTrailMeters(
  point: { lat: number; lng: number },
  trail: GeoJSON.LineString | GeoJSON.MultiLineString,
): number {
  const pt = turf.point([point.lng, point.lat]);
  let best = Infinity;
  for (const coords of geometrySegments(trail)) {
    if (coords.length < 2) continue;
    const d = turf.pointToLineDistance(pt, turf.lineString(coords), { units: "meters" });
    if (d < best) best = d;
  }
  return Number.isFinite(best) ? best : Number.NaN;
}

export function nearestPointOnTrail(
  point: { lat: number; lng: number },
  trail: GeoJSON.LineString | GeoJSON.MultiLineString,
): { lat: number; lng: number; distanceMeters: number; index: number } {
  const pt = turf.point([point.lng, point.lat]);
  let best: { lat: number; lng: number; distanceMeters: number; index: number } | null = null;
  let indexOffset = 0;
  for (const coords of geometrySegments(trail)) {
    if (coords.length < 2) continue;
    const snapped = turf.nearestPointOnLine(turf.lineString(coords), pt, { units: "meters" });
    const d = snapped.properties.dist ?? Infinity;
    if (!best || d < best.distanceMeters) {
      best = {
        lng: snapped.geometry.coordinates[0],
        lat: snapped.geometry.coordinates[1],
        distanceMeters: d,
        index: indexOffset + (snapped.properties.index ?? 0),
      };
    }
    indexOffset += coords.length;
  }
  return best ?? { lat: point.lat, lng: point.lng, distanceMeters: Number.NaN, index: 0 };
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

function sampleAlongSegments(
  segments: GeoJSON.Position[][],
  samples: number,
): Array<{ lat: number; lng: number; distanceMeters: number }> {
  const lengths = segments.map((coords) =>
    coords.length >= 2 ? turf.length(turf.lineString(coords), { units: "meters" }) : 0,
  );
  const total = lengths.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return [];
  const points: Array<{ lat: number; lng: number; distanceMeters: number }> = [];
  for (let i = 0; i <= samples; i++) {
    const target = (total * i) / samples;
    let walked = 0;
    let picked: { lat: number; lng: number } | null = null;
    for (let s = 0; s < segments.length; s++) {
      const segLen = lengths[s];
      if (target <= walked + segLen || s === segments.length - 1) {
        const along = Math.min(Math.max(target - walked, 0), segLen);
        const pt = turf.along(turf.lineString(segments[s]), along, { units: "meters" });
        picked = { lat: pt.geometry.coordinates[1], lng: pt.geometry.coordinates[0] };
        break;
      }
      walked += segLen;
    }
    if (picked) points.push({ ...picked, distanceMeters: target });
  }
  return points;
}

export async function fetchElevationProfile(
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString,
  samples: number = 50,
): Promise<Array<{ distanceMeters: number; elevation: number }>> {
  const segments = geometrySegments(geometry);
  const points = sampleAlongSegments(segments, samples);
  const length = points[points.length - 1]?.distanceMeters ?? 0;

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
        distanceMeters: points[i]?.distanceMeters ?? (length * i) / samples,
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
  const segments = geometrySegments(geometry);
  const segs = segments
    .map((coords) => {
      const trkpts = coords
        .map(([lng, lat]) => `      <trkpt lat="${lat}" lon="${lng}"></trkpt>`)
        .join("\n");
      return `    <trkseg>\n${trkpts}\n    </trkseg>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Hike App">
  <trk>
    <name>${escapeXml(name)}</name>
${segs}
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

const GPX_MAX_CHARS = 5_000_000;
const GPX_MAX_POINTS = 20_000;

function parseTrkptAttrs(tag: string, body = ""): GeoJSON.Position | null {
  const lat = /lat="([^"]+)"/.exec(tag)?.[1];
  const lon = /lon="([^"]+)"/.exec(tag)?.[1];
  if (lat == null || lon == null) return null;
  const lng = Number(lon);
  const la = Number(lat);
  if (!Number.isFinite(lng) || !Number.isFinite(la)) return null;
  if (la < -90 || la > 90 || lng < -180 || lng > 180) return null;
  const eleRaw = /<ele>\s*([^<]+)\s*<\/ele>/i.exec(body)?.[1];
  const ele = eleRaw != null ? Number(eleRaw) : Number.NaN;
  return Number.isFinite(ele) ? [lng, la, ele] : [lng, la];
}

export function parseGpx(
  gpxContent: string,
): GeoJSON.LineString | GeoJSON.MultiLineString | null {
  if (!gpxContent || gpxContent.length > GPX_MAX_CHARS) return null;
  const segRe = /<trkseg\b[^>]*>([\s\S]*?)<\/trkseg>/gi;
  const ptRe = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>|<trkpt\b([^>]*)\/>/gi;
  const segments: GeoJSON.Position[][] = [];
  let total = 0;
  let segMatch: RegExpExecArray | null;
  while ((segMatch = segRe.exec(gpxContent)) !== null) {
    const coords: GeoJSON.Position[] = [];
    let pt: RegExpExecArray | null;
    const body = segMatch[1];
    ptRe.lastIndex = 0;
    while ((pt = ptRe.exec(body)) !== null) {
      const attrs = pt[1] ?? pt[3] ?? "";
      const pos = parseTrkptAttrs(attrs, pt[2] ?? "");
      if (!pos) continue;
      coords.push(pos);
      total += 1;
      if (total > GPX_MAX_POINTS) return null;
    }
    if (coords.length >= 2) segments.push(coords);
  }

  if (segments.length === 0) {
    const coords: GeoJSON.Position[] = [];
    let pt: RegExpExecArray | null;
    const all = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>|<trkpt\b([^>]*)\/>/gi;
    while ((pt = all.exec(gpxContent)) !== null) {
      const attrs = pt[1] ?? pt[3] ?? "";
      const pos = parseTrkptAttrs(attrs, pt[2] ?? "");
      if (!pos) continue;
      coords.push(pos);
      if (coords.length > GPX_MAX_POINTS) return null;
    }
    if (coords.length < 2) return null;
    return { type: "LineString", coordinates: coords };
  }

  if (segments.length === 1) {
    return { type: "LineString", coordinates: segments[0] };
  }
  return { type: "MultiLineString", coordinates: segments };
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
