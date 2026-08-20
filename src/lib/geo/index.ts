import * as turf from "@turf/turf";
import { minimumLongitudeInterval } from "@/lib/geo/antimeridian";

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

  return {
    distanceMeters,
    elevationGainMeters,
    durationSeconds: 0,
    avgPaceMinPerKm: 0,
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
  if (!Number.isFinite(meters) || meters < 0) return "—";
  const miles = meters / 1609.34;
  if (miles >= 0.1) return `${miles.toFixed(1)} mi`;
  return `${Math.round(meters)} m`;
}

export function formatElevation(meters: number): string {
  if (!Number.isFinite(meters)) return "—";
  const feet = meters * 3.28084;
  return `${Math.round(feet).toLocaleString()} ft`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatPace(minPerKm: number): string {
  if (!Number.isFinite(minPerKm) || minPerKm < 0) return "—";
  const minPerMile = minPerKm * 1.60934;
  const mins = Math.floor(minPerMile);
  const secs = Math.round((minPerMile - mins) * 60);
  return `${mins}:${secs.toString().padStart(2, "0")} /mi`;
}

const ELEVATION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const elevationCache = new Map<string, {
  expiresAt: number;
  profile: Array<{ distanceMeters: number; elevation: number }>;
}>();

function cacheElevationProfile(key: string, profile: Array<{ distanceMeters: number; elevation: number }>) {
  elevationCache.set(key, { expiresAt: Date.now() + ELEVATION_CACHE_TTL_MS, profile });
  return profile;
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
  const cacheKey = JSON.stringify({ geometry, samples });
  const cached = elevationCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.profile;
  if (cached) elevationCache.delete(cacheKey);

  const segments = geometrySegments(geometry);
  const points = sampleAlongSegments(segments, samples);
  const length = points[points.length - 1]?.distanceMeters ?? 0;
  if (!points.length) return cacheElevationProfile(cacheKey, []);

  try {
    const response = await fetch("https://api.open-elevation.com/api/v1/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locations: points.map((point) => ({ latitude: point.lat, longitude: point.lng })) }),
    });
    if (!response.ok) return cacheElevationProfile(cacheKey, []);
    const data = await response.json();
    const profile = (data.results || [])
      .filter((result: { elevation?: unknown }) => typeof result.elevation === "number" && Number.isFinite(result.elevation))
      .map((result: { elevation: number }, index: number) => ({
        distanceMeters: points[index]?.distanceMeters ?? (length * index) / samples,
        elevation: result.elevation,
      }));
    return cacheElevationProfile(cacheKey, profile);
  } catch {
    return cacheElevationProfile(cacheKey, []);
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
  const trkpts = points.map((point) => {
    const ele = point.elevation != null ? `\n        <ele>${point.elevation}</ele>` : "";
    const time = point.recordedAt ? `\n        <time>${point.recordedAt.toISOString()}</time>` : "";
    return `      <trkpt lat="${point.lat}" lon="${point.lng}">${ele}${time}\n      </trkpt>`;
  }).join("\n");
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
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const GPX_MAX_CHARS = 5_000_000;
const GPX_MAX_POINTS = 20_000;
const STRICT_DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

function parseStrictDecimal(raw: string | undefined): number | null {
  const normalized = raw?.trim();
  if (!normalized || !STRICT_DECIMAL.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function parsePoints(xml: string, tag: "trkpt" | "rtept"): GeoJSON.Position[] | null {
  const points: GeoJSON.Position[] = [];
  const tagRegex = new RegExp(`<${tag}\\b([^>]*)(?:/>|>([\\s\\S]*?)</${tag}>)`, "gi");
  for (const match of xml.matchAll(tagRegex)) {
    const attributes = match[1];
    const body = match[2] ?? "";
    const lat = attributes.match(/\blat\s*=\s*(["'])(.*?)\1/i)?.[2];
    const lng = attributes.match(/\blon\s*=\s*(["'])(.*?)\1/i)?.[2];
    // parseFloat accepts numeric prefixes (for example "12evil"). GPX
    // coordinates must be complete strict decimal values, never a best effort.
    const parsedLat = parseStrictDecimal(lat);
    const parsedLng = parseStrictDecimal(lng);
    if (parsedLat == null || parsedLng == null) return null;
    if (parsedLat < -90 || parsedLat > 90 || parsedLng < -180 || parsedLng > 180) return null;
    const eleRaw = /<ele>\s*([^<]+)\s*<\/ele>/i.exec(body)?.[1];
    const ele = eleRaw != null ? Number(eleRaw.trim()) : Number.NaN;
    points.push(Number.isFinite(ele) ? [parsedLng, parsedLat, ele] : [parsedLng, parsedLat]);
    if (points.length > GPX_MAX_POINTS) return null;
  }
  return points;
}

export function parseGpx(gpxContent: string): GeoJSON.LineString | GeoJSON.MultiLineString | null {
  if (typeof gpxContent !== "string" || !gpxContent || gpxContent.length > GPX_MAX_CHARS) return null;
  const parsedSegments = [...gpxContent.matchAll(/<trkseg\b[^>]*>([\s\S]*?)<\/trkseg>/gi)]
    .map((match) => parsePoints(match[1], "trkpt"));
  if (parsedSegments.some((segment) => segment === null)) return null;
  const segments = parsedSegments.filter((segment): segment is GeoJSON.Position[] => segment !== null && segment.length >= 2);
  if (segments.length === 0) {
    const trackPoints = parsePoints(gpxContent, "trkpt");
    if (trackPoints === null) return null;
    if (trackPoints.length >= 2) segments.push(trackPoints);
  }
  if (segments.length === 0) {
    const routePoints = parsePoints(gpxContent, "rtept");
    if (routePoints === null) return null;
    if (routePoints.length >= 2) segments.push(routePoints);
  }
  if (segments.length === 0) return null;
  return segments.length === 1
    ? { type: "LineString", coordinates: segments[0] }
    : { type: "MultiLineString", coordinates: segments };
}

function positionsFromGeometry(
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString,
): GeoJSON.Position[] | null {
  if (geometry.type === "LineString") {
    return Array.isArray(geometry.coordinates) ? geometry.coordinates : null;
  }
  if (geometry.type !== "MultiLineString" || !Array.isArray(geometry.coordinates)) return null;
  const coords: GeoJSON.Position[] = [];
  for (const line of geometry.coordinates) {
    if (!Array.isArray(line)) return null;
    for (const coordinate of line) coords.push(coordinate);
  }
  return coords;
}

export function bboxFromGeometry(
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString,
  padding = 0.01,
): [number, number, number, number] | null {
  if (!Number.isFinite(padding) || padding < 0) return null;
  if (!geometry || typeof geometry !== "object") return null;
  const coords = positionsFromGeometry(geometry);
  if (!coords) return null;

  let minLat = Infinity;
  let maxLat = -Infinity;

  for (const coordinate of coords) {
    if (!Array.isArray(coordinate)) return null;
    const [lng, lat] = coordinate;
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) {
      return null;
    }
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  const longitude = minimumLongitudeInterval(coords.map(([lng]) => lng));
  if (!longitude || !Number.isFinite(minLat) || !Number.isFinite(maxLat)) return null;

  return [
    longitude.minLng - padding,
    minLat - padding,
    longitude.maxLng + padding,
    maxLat + padding,
  ];
}
