import * as turf from "@turf/turf";
import { bboxFromGeometry, formatDistance } from "@/lib/geo";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface TrailProgress {
  nearest: LatLng;
  offsetMeters: number;
  traveledMeters: number;
  remainingMeters: number;
  totalMeters: number;
  remainingElevationMeters: number;
  bearingToTrail: number;
}

export function toLineString(
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString,
): GeoJSON.LineString {
  if (geometry.type === "LineString") return geometry;
  return {
    type: "LineString",
    coordinates: geometry.coordinates.flat(),
  };
}

export function trailLengthMeters(
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString,
): number {
  return turf.length(turf.feature(toLineString(geometry)), { units: "meters" });
}

export function progressAlongTrail(
  point: LatLng,
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString,
  elevationProfile: Array<{ distanceMeters: number; elevation: number }> = [],
): TrailProgress {
  const line = toLineString(geometry);
  const lineFeature = turf.lineString(line.coordinates);
  const pt = turf.point([point.lng, point.lat]);
  const snapped = turf.nearestPointOnLine(lineFeature, pt, { units: "meters" });
  const nearest = {
    lng: snapped.geometry.coordinates[0],
    lat: snapped.geometry.coordinates[1],
  };
  const offsetMeters = snapped.properties.dist ?? 0;
  const totalMeters = turf.length(lineFeature, { units: "meters" });
  const location = snapped.properties.location ?? 0;
  const traveledMeters = Math.min(Math.max(location, 0), totalMeters);
  const remainingMeters = Math.max(totalMeters - traveledMeters, 0);

  return {
    nearest,
    offsetMeters,
    traveledMeters,
    remainingMeters,
    totalMeters,
    remainingElevationMeters: remainingElevationGain(
      elevationProfile,
      traveledMeters,
    ),
    bearingToTrail: turf.bearing(pt, turf.point([nearest.lng, nearest.lat])),
  };
}

export function remainingElevationGain(
  profile: Array<{ distanceMeters: number; elevation: number }>,
  traveledMeters: number,
): number {
  if (profile.length < 2) return 0;
  let gain = 0;
  for (let i = 1; i < profile.length; i++) {
    const prev = profile[i - 1];
    const curr = profile[i];
    if (curr.distanceMeters <= traveledMeters) continue;
    const startElev =
      prev.distanceMeters < traveledMeters
        ? interpolateElevation(prev, curr, traveledMeters)
        : prev.elevation;
    const diff = curr.elevation - startElev;
    if (diff > 0) gain += diff;
  }
  return gain;
}

function interpolateElevation(
  a: { distanceMeters: number; elevation: number },
  b: { distanceMeters: number; elevation: number },
  at: number,
): number {
  const span = b.distanceMeters - a.distanceMeters;
  if (span <= 0) return b.elevation;
  const t = (at - a.distanceMeters) / span;
  return a.elevation + (b.elevation - a.elevation) * t;
}

export function normalizeHeading(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

export function compassLabel(heading: number): string {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const index = Math.round(normalizeHeading(heading) / 45) % 8;
  return dirs[index];
}

export function gpsAccuracyLabel(accuracyMeters?: number | null): string {
  if (accuracyMeters == null) return "Unknown accuracy";
  if (accuracyMeters <= 8) return `GPS ±${Math.round(accuracyMeters)} m (good)`;
  if (accuracyMeters <= 20) return `GPS ±${Math.round(accuracyMeters)} m (fair)`;
  return `GPS ±${Math.round(accuracyMeters)} m (poor — canyon/trees)`;
}

export function formatRemaining(meters: number): string {
  return formatDistance(meters);
}

export function safeBbox(
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString,
  extra?: LatLng,
): [number, number, number, number] {
  const bbox = bboxFromGeometry(geometry, 0.004);
  if (!extra) return bbox;
  return [
    Math.min(bbox[0], extra.lng - 0.004),
    Math.min(bbox[1], extra.lat - 0.004),
    Math.max(bbox[2], extra.lng + 0.004),
    Math.max(bbox[3], extra.lat + 0.004),
  ];
}

export function isValidGeometry(
  geometry: unknown,
): geometry is GeoJSON.LineString | GeoJSON.MultiLineString {
  if (!geometry || typeof geometry !== "object") return false;
  const g = geometry as GeoJSON.LineString | GeoJSON.MultiLineString;
  if (g.type === "LineString") {
    return Array.isArray(g.coordinates) && g.coordinates.length >= 2;
  }
  if (g.type === "MultiLineString") {
    return (
      Array.isArray(g.coordinates) &&
      g.coordinates.some((line) => line.length >= 2)
    );
  }
  return false;
}
