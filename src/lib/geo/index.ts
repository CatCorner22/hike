import * as turf from "@turf/turf";

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

function parsePoints(xml: string, tag: "trkpt" | "rtept"): GeoJSON.Position[] {
  const points: GeoJSON.Position[] = [];
  const tagRegex = new RegExp(`<${tag}\\b([^>]*)/?>`, "gi");
  for (const match of xml.matchAll(tagRegex)) {
    const attributes = match[1];
    const lat = attributes.match(/\blat\s*=\s*(["'])(.*?)\1/i)?.[2];
    const lng = attributes.match(/\blon\s*=\s*(["'])(.*?)\1/i)?.[2];
    if (lat == null || lng == null) continue;
    const parsedLat = Number.parseFloat(lat);
    const parsedLng = Number.parseFloat(lng);
    if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng) || parsedLat < -90 || parsedLat > 90 || parsedLng < -180 || parsedLng > 180) continue;
    points.push([parsedLng, parsedLat]);
  }
  return points;
}

export function parseGpx(gpxContent: string): GeoJSON.LineString | GeoJSON.MultiLineString | null {
  if (typeof gpxContent !== "string") return null;
  const segments = [...gpxContent.matchAll(/<trkseg\b[^>]*>([\s\S]*?)<\/trkseg>/gi)]
    .map((match) => parsePoints(match[1], "trkpt"))
    .filter((segment) => segment.length >= 2);
  if (segments.length === 0) {
    const trackPoints = parsePoints(gpxContent, "trkpt");
    if (trackPoints.length >= 2) segments.push(trackPoints);
  }
  if (segments.length === 0) {
    const routePoints = parsePoints(gpxContent, "rtept");
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
