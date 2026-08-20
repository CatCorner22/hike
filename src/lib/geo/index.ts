import * as turf from "@turf/turf";
import { minimumLongitudeInterval } from "@/lib/geo/antimeridian";

export function lineLengthMeters(
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString,
): number {
  const feature = turf.feature(geometry);
  return turf.length(feature, { units: "meters" });
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

export async function fetchElevationProfile(
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString,
  samples: number = 50,
): Promise<Array<{ distanceMeters: number; elevation: number }>> {
  const cacheKey = JSON.stringify({ geometry, samples });
  const cached = elevationCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.profile;
  if (cached) elevationCache.delete(cacheKey);

  const line = turf.lineString(
    geometry.type === "LineString" ? geometry.coordinates : geometry.coordinates.flat(),
  );
  const length = turf.length(line, { units: "meters" });
  const points: Array<{ lat: number; lng: number }> = [];
  for (let i = 0; i <= samples; i++) {
    const point = turf.along(line, (length * i) / samples, { units: "meters" });
    points.push({ lat: point.geometry.coordinates[1], lng: point.geometry.coordinates[0] });
  }

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
        distanceMeters: (length * index) / samples,
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
  const segments = geometry.type === "LineString" ? [geometry.coordinates] : geometry.coordinates;
  const trksegs = segments.map((coordinates) => `    <trkseg>
${coordinates
    .map(([lng, lat]) => `      <trkpt lat="${lat}" lon="${lng}"></trkpt>`)
    .join("\n")}
    </trkseg>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Hike App">
  <trk>
    <name>${escapeXml(name)}</name>
${trksegs}
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

const STRICT_DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

function parsePoints(xml: string, tag: "trkpt" | "rtept"): GeoJSON.Position[] | null {
  const points: GeoJSON.Position[] = [];
  const tagRegex = new RegExp(`<${tag}\\b([^>]*)/?>`, "gi");
  for (const match of xml.matchAll(tagRegex)) {
    const attributes = match[1];
    const lat = attributes.match(/\blat\s*=\s*(["'])(.*?)\1/i)?.[2];
    const lng = attributes.match(/\blon\s*=\s*(["'])(.*?)\1/i)?.[2];
    const normalizedLat = lat?.trim();
    const normalizedLng = lng?.trim();
    // parseFloat accepts numeric prefixes (for example "12evil"). GPX
    // coordinates must be complete strict decimal values, never a best effort.
    if (!normalizedLat || !normalizedLng || !STRICT_DECIMAL.test(normalizedLat) || !STRICT_DECIMAL.test(normalizedLng)) return null;
    const parsedLat = Number(normalizedLat);
    const parsedLng = Number(normalizedLng);
    if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng) || parsedLat < -90 || parsedLat > 90 || parsedLng < -180 || parsedLng > 180) return null;
    points.push([parsedLng, parsedLat]);
  }
  return points;
}

export function parseGpx(gpxContent: string): GeoJSON.LineString | GeoJSON.MultiLineString | null {
  if (typeof gpxContent !== "string") return null;
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

export function bboxFromGeometry(
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString,
  padding = 0.01,
): [number, number, number, number] | null {
  if (!Number.isFinite(padding) || padding < 0) return null;
  if (!geometry || typeof geometry !== "object") return null;
  const coords =
    geometry.type === "LineString"
      ? Array.isArray(geometry.coordinates) ? geometry.coordinates : null
      : geometry.type === "MultiLineString" && Array.isArray(geometry.coordinates)
        ? geometry.coordinates.flat()
        : null;
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
