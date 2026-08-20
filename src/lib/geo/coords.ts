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
