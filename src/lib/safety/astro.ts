/** Synodic month. New moon near 2000-01-06 18:14 UTC. */
const SYNODIC = 29.530588;
const NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14);

export function moonPhase(date = new Date()): {
  ageDays: number;
  illumination: number;
  name: string;
  nightNav: string;
} {
  const age = ((date.getTime() - NEW_MOON_MS) / 86400000) % SYNODIC;
  const ageDays = age < 0 ? age + SYNODIC : age;
  const illumination = (1 - Math.cos((ageDays / SYNODIC) * 2 * Math.PI)) / 2;
  const pct = Math.round(illumination * 100);

  let name = "Waxing crescent";
  if (ageDays < 1.5 || ageDays > SYNODIC - 1.5) name = "New moon";
  else if (ageDays < 6.5) name = "Waxing crescent";
  else if (ageDays < 8.5) name = "First quarter";
  else if (ageDays < 13.5) name = "Waxing gibbous";
  else if (ageDays < 16.5) name = "Full moon";
  else if (ageDays < 21.5) name = "Waning gibbous";
  else if (ageDays < 23.5) name = "Last quarter";
  else name = "Waning crescent";

  let nightNav: string;
  if (pct < 15) {
    nightNav = `${name} (~${pct}% lit) — dark night. Red light, short legs, pace count.`;
  } else if (pct < 50) {
    nightNav = `${name} (~${pct}% lit) — weak moonlight. Handrails and catching features matter more.`;
  } else if (pct < 85) {
    nightNav = `${name} (~${pct}% lit) — usable moonlight. Still use red near other hikers.`;
  } else {
    nightNav = `${name} (~${pct}% lit) — good night movement light. Shadows can hide drop-offs.`;
  }

  return { ageDays, illumination, name, nightNav };
}

/** Approximate solar azimuth (degrees from true north, clockwise) and elevation. */
export function sunPosition(
  date: Date,
  lat: number,
  lng: number,
): { azimuth: number; elevation: number } | null {
  const rad = Math.PI / 180;
  const d =
    (Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes()) -
      Date.UTC(date.getUTCFullYear(), 0, 0)) /
    86400000;
  const g = ((357.529 + 0.98560028 * d) % 360) * rad;
  const q = (280.459 + 0.98564736 * d) % 360;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const e = (23.439 - 0.00000036 * d) * rad;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (6.697375 + 0.0657098242 * d + date.getUTCHours() + date.getUTCMinutes() / 60) % 24;
  const lst = ((gmst * 15 + lng) * rad + 4 * Math.PI) % (2 * Math.PI);
  const ha = lst - ra;
  const phi = lat * rad;
  const elev = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha));
  const az = (Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(ha)) * 180) / Math.PI;
  const azimuth = ((az % 360) + 360) % 360;
  return { azimuth, elevation: (elev * 180) / Math.PI };
}

/** Shadow-stick: the shadow points opposite the sun; walk that azimuth + 180 for sun-line. */
export function shadowStickHeading(sunAzimuth: number): { shadowToward: number; sunToward: number } {
  return {
    sunToward: ((sunAzimuth % 360) + 360) % 360,
    shadowToward: (((sunAzimuth + 180) % 360) + 360) % 360,
  };
}

export function sunCompassHint(date: Date, lat: number, lng: number): string | null {
  const pos = sunPosition(date, lat, lng);
  if (!pos || pos.elevation < 5) return "Sun too low or below horizon — use moon, stars, or compass.";
  const stick = shadowStickHeading(pos.azimuth);
  return `Sun ~${Math.round(pos.azimuth)}° true (elev ${Math.round(pos.elevation)}°). Shadow points ~${Math.round(stick.shadowToward)}° — check your compass against that.`;
}
