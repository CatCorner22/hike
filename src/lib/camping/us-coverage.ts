import type { Bbox } from "@/lib/camping/bbox";

export type UsCoverageRegion = readonly [west: number, south: number, east: number, north: number];

// Broad coverage rectangles include all states and inhabited U.S. territories.
// They are a product-coverage guard, not a land-ownership or jurisdiction test.
export const US_COVERAGE_REGIONS: readonly UsCoverageRegion[] = [
  [-125, 24, -66, 50], // contiguous U.S.
  [-180, 51, -129, 72], // Alaska east of the antimeridian
  [169, 51, 180, 72], // western Aleutians
  [-161, 18, -154, 23], // Hawaii
  [-68.5, 17.5, -64.5, 19.5], // Puerto Rico and U.S. Virgin Islands
  [144, 13, 146.5, 21.5], // Guam and Northern Mariana Islands
  [-171.5, -15, -168, -10], // American Samoa
];

export function isUsCoverageCoordinate(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return US_COVERAGE_REGIONS.some(([west, south, east, north]) => (
    lng >= west && lng <= east && lat >= south && lat <= north
  ));
}

export function nearbyCampingBbox(lat: number, lng: number, radiusKm = 80): Bbox | null {
  if (!isUsCoverageCoordinate(lat, lng) || !Number.isFinite(radiusKm) || radiusKm < 5 || radiusKm > 250) return null;
  const latDelta = radiusKm / 111;
  const lngScale = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const lngDelta = Math.min(4, radiusKm / (111 * lngScale));
  const west = Math.max(-180, lng - lngDelta);
  const east = Math.min(180, lng + lngDelta);
  const south = Math.max(-90, lat - latDelta);
  const north = Math.min(90, lat + latDelta);
  return west < east && south < north ? [west, south, east, north] : null;
}
