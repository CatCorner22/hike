import { naismithMinutes } from "@/lib/safety/pace";
import { utmZone } from "@/lib/safety/usng";
import { isLongitudeInInterval } from "@/lib/geo/antimeridian";

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

/**
 * UTM grid convergence (degrees, east-positive): the angle between grid north and
 * true north. Reaches ~3° at a zone edge, so it is not optional in a grid workflow.
 * Convention: grid azimuth = true azimuth − convergence.
 */
export function gridConvergence(lat: number, lng: number): number | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  const rad = Math.PI / 180;
  const zone = utmZone(lat, lng);
  if (zone == null) return null;
  const lon0 = (zone - 1) * 6 - 180 + 3;
  return (Math.atan(Math.tan((lng - lon0) * rad) * Math.sin(lat * rad)) * 180) / Math.PI;
}

/**
 * G-M card: grid → magnetic includes UTM convergence (true − grid).
 * The app plots on UTM/USNG, so converting from declination alone is wrong by up to ~3°.
 */
export function gmAngleCard(lat: number, lng: number): {
  declination: number;
  convergence: number;
  gmAngle: number;
  east: boolean;
  gridToMagnetic: string;
  magneticToGrid: string;
  lars: string;
} | null {
  const declination = magneticDeclination(lat, lng);
  if (declination == null) {
    return {
      declination: Number.NaN,
      convergence: Number.NaN,
      gmAngle: Number.NaN,
      east: true,
      gridToMagnetic: "Magnetic unavailable here — use true / grid only.",
      magneticToGrid: "Magnetic unavailable — do not convert compass bearings.",
      lars: "No G-M model outside the North America grid. Treat compass as unconverted.",
    };
  }
  const convergence = gridConvergence(lat, lng);
  if (convergence == null) {
    return {
      declination,
      convergence: Number.NaN,
      gmAngle: Number.NaN,
      east: true,
      gridToMagnetic: "Magnetic unavailable here — use true / grid only.",
      magneticToGrid: "Magnetic unavailable — do not convert compass bearings.",
      lars: "No G-M model outside the North America grid. Treat compass as unconverted.",
    };
  }
  const gmAngle = declination - convergence;
  const east = gmAngle >= 0;
  const abs = Math.abs(gmAngle).toFixed(1);
  return {
    declination,
    convergence,
    gmAngle,
    east,
    gridToMagnetic: east
      ? `Grid → mag: subtract ${abs}° (decl ${declination.toFixed(1)}° · conv ${convergence.toFixed(1)}°)`
      : `Grid → mag: add ${abs}° (decl ${declination.toFixed(1)}° · conv ${convergence.toFixed(1)}°)`,
    magneticToGrid: east
      ? `Mag → grid: add ${abs}°`
      : `Mag → grid: subtract ${abs}°`,
    lars: "LARS: Left Add, Right Subtract — when the G-M arrow is left/right of grid north.",
  };
}

export function formatWalkBearing(trueBearing: number, lat?: number, lng?: number): string {
  if (!Number.isFinite(trueBearing)) return "—";
  // turf.bearing returns -180..180; a compass has no -122°.
  const heading = ((trueBearing % 360) + 360) % 360;
  const trueLabel = `${Math.round(heading) % 360}° true`;
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return trueLabel;
  const dec = magneticDeclination(lat, lng);
  if (dec == null) return trueLabel;
  return `${trueLabel} / ${Math.round(toMagneticBearing(heading, dec)) % 360}° magnetic`;
}

export function isFixNearRouteBbox(
  lat: number,
  lng: number,
  bbox: [number, number, number, number],
  padDeg = 0.08,
): boolean {
  if (
    !Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180 ||
    ![...bbox, padDeg].every(Number.isFinite) || padDeg < 0
  ) return false;
  const [minLng, minLat, maxLng, maxLat] = bbox;
  return isLongitudeInInterval(lng, { minLng, maxLng }, padDeg) && lat >= minLat - padDeg && lat <= maxLat + padDeg;
}

/**
 * Fires when the remaining route cannot be finished before sunset.
 *
 * Uses `naismithMinutes` — the same estimator the navigate screen prints — so the
 * warning cannot disagree with the ETA shown beside it. The previous flat 5 km/h with
 * no climb allowance and a 10-minute grace under-estimated in three directions at once,
 * all of them unsafe.
 */
export function turnaroundWarning(
  remainingMeters: number,
  remainingGainMeters: number,
  minutesUntilSunset: number,
  isDark: boolean,
): string | null {
  if (isDark || remainingMeters <= 0) return null;
  const minutesNeeded = naismithMinutes(remainingMeters, Math.max(0, remainingGainMeters));
  if (minutesNeeded <= 0) return null;

  if (minutesUntilSunset <= 0) {
    return `The sun is already down and this route still needs ~${minutesNeeded} min. Turn around or finish with a headlamp.`;
  }
  if (minutesNeeded > minutesUntilSunset) {
    const climb =
      remainingGainMeters >= 25 ? ` (${Math.round(remainingGainMeters)} m of climb left)` : "";
    return `This route still needs ~${minutesNeeded} min${climb}; sunset is in ${minutesUntilSunset} min. Turn around or finish with a headlamp.`;
  }
  return null;
}
