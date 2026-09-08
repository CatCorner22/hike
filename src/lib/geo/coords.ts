/**
 * Coordinates from a device, imported file, or persisted route are untrusted at
 * runtime. A plausible calculation from an impossible point is more dangerous
 * than no calculation: it can send a hiker confidently in the wrong direction.
 */
export interface GeographicCoordinate {
  lat: number;
  lng: number;
}

export function isValidCoordinate(value: unknown): value is GeographicCoordinate {
  if (!value || typeof value !== "object") return false;
  const candidate = value as GeographicCoordinate;
  return Number.isFinite(candidate.lat) &&
    Number.isFinite(candidate.lng) &&
    candidate.lat >= -90 &&
    candidate.lat <= 90 &&
    candidate.lng >= -180 &&
    candidate.lng <= 180;
}

/** GeoJSON order: [lng, lat]. Bounds-checked because stored positions are untrusted. */
export function isFinitePosition(position: unknown): position is GeoJSON.Position {
  return Array.isArray(position) &&
    position.length >= 2 &&
    Number.isFinite(position[0]) &&
    Number.isFinite(position[1]) &&
    Number(position[0]) >= -180 && Number(position[0]) <= 180 &&
    Number(position[1]) >= -90 && Number(position[1]) <= 90;
}

const EARTH_RADIUS_M = 6_371_000;

/**
 * Great-circle distance in metres. The one shared implementation — this
 * formula existed as seven private copies before, which is seven chances for
 * one of them to drift.
 */
export function haversineMeters(a: GeographicCoordinate, b: GeographicCoordinate): number {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLng = (b.lng - a.lng) * toRad;
  const lat1 = a.lat * toRad;
  const lat2 = b.lat * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
