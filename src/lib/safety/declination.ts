/**
 * Approximate magnetic declination (degrees, east-positive) for hiking use.
 * Coarse WMM-2025-style grid covering North America; not for surveying.
 */
const LATS = [25, 35, 45, 55, 65];
const LNGS = [-150, -130, -120, -110, -100, -90, -80, -70, -60];

// Rows = LATS, cols = LNGS. Values from WMM-like 2025/2026 field.
const DECL: number[][] = [
  [10, 12, 10, 8, 5, 1, -6, -9, -13],
  [12, 14, 13, 10, 6, 0, -7, -12, -15],
  [16, 16, 15, 12, 6, 0, -9, -14, -17],
  [18, 18, 17, 14, 8, -1, -12, -17, -21],
  [15, 20, 19, 16, 9, -3, -16, -21, -25],
];

export function magneticDeclination(lat: number, lng: number): number | null {
  if (lat < LATS[0] || lat > LATS[LATS.length - 1]) return null;
  if (lng < LNGS[0] || lng > LNGS[LNGS.length - 1]) return null;

  let i = 0;
  while (i < LATS.length - 2 && lat > LATS[i + 1]) i += 1;
  let j = 0;
  while (j < LNGS.length - 2 && lng > LNGS[j + 1]) j += 1;

  const t = (lat - LATS[i]) / (LATS[i + 1] - LATS[i]);
  const u = (lng - LNGS[j]) / (LNGS[j + 1] - LNGS[j]);
  const a = DECL[i][j] * (1 - t) + DECL[i + 1][j] * t;
  const b = DECL[i][j + 1] * (1 - t) + DECL[i + 1][j + 1] * t;
  return a * (1 - u) + b * u;
}

export function toMagneticBearing(trueBearing: number, declination: number): number {
  return ((trueBearing - declination) % 360 + 360) % 360;
}

export function toTrueBearing(magneticBearing: number, declination: number): number {
  return ((magneticBearing + declination) % 360 + 360) % 360;
}

/** G-M card: east declination means magnetic is east of true/grid. */
export function gmAngleCard(lat: number, lng: number): {
  declination: number;
  east: boolean;
  gridToMagnetic: string;
  magneticToGrid: string;
  lars: string;
} | null {
  const declination = magneticDeclination(lat, lng);
  if (declination == null) return null;
  const east = declination >= 0;
  const abs = Math.abs(declination).toFixed(1);
  return {
    declination,
    east,
    gridToMagnetic: east
      ? `Grid → mag: subtract ${abs}° (east is least)`
      : `Grid → mag: add ${abs}° (west is best)`,
    magneticToGrid: east
      ? `Mag → grid: add ${abs}°`
      : `Mag → grid: subtract ${abs}°`,
    lars: "LARS: Left Add, Right Subtract — when the G-M arrow is left/right of grid north.",
  };
}

export function formatWalkBearing(trueBearing: number, lat?: number, lng?: number): string {
  const trueLabel = `${Math.round(trueBearing)}° true`;
  if (lat == null || lng == null) return trueLabel;
  const dec = magneticDeclination(lat, lng);
  if (dec == null) return trueLabel;
  return `${trueLabel} / ${Math.round(toMagneticBearing(trueBearing, dec))}° magnetic`;
}

export function isFixNearRouteBbox(
  lat: number,
  lng: number,
  bbox: [number, number, number, number],
  padDeg = 0.08,
): boolean {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  return (
    lng >= minLng - padDeg &&
    lng <= maxLng + padDeg &&
    lat >= minLat - padDeg &&
    lat <= maxLat + padDeg
  );
}

const WALK_MPS = 5000 / 3600;

export function turnaroundWarning(
  remainingMeters: number,
  minutesUntilSunset: number,
  isDark: boolean,
): string | null {
  if (isDark || remainingMeters <= 0) return null;
  if (minutesUntilSunset <= 0) return null;
  const minutesNeeded = remainingMeters / WALK_MPS / 60;
  if (minutesNeeded > minutesUntilSunset + 10) {
    return `At an easy pace this route still needs ~${Math.round(minutesNeeded)} min; sunset is in ${minutesUntilSunset} min. Turn around or finish with a headlamp.`;
  }
  return null;
}
