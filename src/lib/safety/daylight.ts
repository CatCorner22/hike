/**
 * Approximate sunrise/sunset using the Wikipedia sunrise equation
 * (NOAA-style mean anomaly + solar transit).
 *
 * All of these resolve the solar day at the caller's own longitude, so
 * `minutesUntilSunset` goes negative after sunset rather than jumping to
 * tomorrow's.
 */
export function estimateSunsetUtc(
  date: Date,
  lat: number,
  lng: number,
): Date | "polar-night" | "midnight-sun" {
  const events = solarEventsUtc(date, lat, lng);
  if (typeof events === "string") return events;
  return events.sunset;
}

export function estimateSunriseUtc(
  date: Date,
  lat: number,
  lng: number,
): Date | "polar-night" | "midnight-sun" {
  const events = solarEventsUtc(date, lat, lng);
  if (typeof events === "string") return events;
  return events.sunrise;
}

export function minutesUntilSunset(date: Date, lat: number, lng: number): number {
  const sunset = estimateSunsetUtc(date, lat, lng);
  if (sunset === "polar-night") return -1;
  if (sunset === "midnight-sun") return 24 * 60;
  return Math.round((sunset.getTime() - date.getTime()) / 60000);
}

export type DaylightStatus = {
  minutesUntilSunset: number;
  isDark: boolean;
  warning: string | null;
};

export function daylightStatus(date: Date, lat: number, lng: number): DaylightStatus {
  const events = solarEventsUtc(date, lat, lng);

  if (events === "polar-night") {
    return {
      minutesUntilSunset: -1,
      isDark: true,
      warning: "Polar night — do not rely on daylight. Carry a headlamp.",
    };
  }
  if (events === "midnight-sun") {
    return { minutesUntilSunset: 24 * 60, isDark: false, warning: null };
  }

  const { sunrise, sunset } = events;
  const afterSunset = date.getTime() >= sunset.getTime();
  const beforeSunrise = date.getTime() < sunrise.getTime();
  const isDark = afterSunset || beforeSunrise;
  const minutesLeft = Math.round((sunset.getTime() - date.getTime()) / 60000);

  return {
    minutesUntilSunset: minutesLeft,
    isDark,
    warning: daylightWarning(minutesLeft, isDark),
  };
}

export function daylightWarning(minutesLeft: number, isDark = minutesLeft <= 0): string | null {
  if (isDark) return "It is dark — use a headlamp and turn back if unsure.";
  if (minutesLeft <= 30) return `${minutesLeft} min until sunset — plan your turnaround.`;
  if (minutesLeft <= 60) return `${minutesLeft} min until sunset.`;
  return null;
}

function solarEventsUtc(
  date: Date,
  lat: number,
  lng: number,
): { sunrise: Date; sunset: Date } | "polar-night" | "midnight-sun" {
  const rad = Math.PI / 180;
  // Resolve the *local solar* day, not the UTC calendar day. West of Greenwich the
  // local evening falls on the next UTC date, so keying off getUTCDate() returns
  // tomorrow's sunrise/sunset and reports darkness hours before the sun actually sets.
  const solarDay = new Date(date.getTime() + (lng / 15) * 3_600_000);
  const noon = Date.UTC(
    solarDay.getUTCFullYear(),
    solarDay.getUTCMonth(),
    solarDay.getUTCDate(),
    12,
  );
  const J = noon / 86400000 + 2440587.5;
  const lw = -lng;
  const n = Math.round(J - 2451545.0009 - lw / 360);
  const Jstar = 2451545.0009 + lw / 360 + n;
  const M = (357.5291 + 0.98560028 * (Jstar - 2451545)) % 360;
  const Mrad = M * rad;
  const C =
    1.9148 * Math.sin(Mrad) + 0.02 * Math.sin(2 * Mrad) + 0.0003 * Math.sin(3 * Mrad);
  const lambda = (M + C + 180 + 102.9372) % 360;
  const Jtransit =
    Jstar + 0.0053 * Math.sin(Mrad) - 0.0069 * Math.sin(2 * lambda * rad);
  const decl = Math.asin(Math.sin(lambda * rad) * Math.sin(23.4397 * rad));
  const phi = lat * rad;
  const cosOmega =
    (Math.sin(-0.83 * rad) - Math.sin(phi) * Math.sin(decl)) /
    (Math.cos(phi) * Math.cos(decl));

  if (cosOmega > 1) return "polar-night";
  if (cosOmega < -1) return "midnight-sun";

  const omegaDays = Math.acos(cosOmega) / (2 * Math.PI);
  return {
    sunrise: fromJulian(Jtransit - omegaDays),
    sunset: fromJulian(Jtransit + omegaDays),
  };
}

function fromJulian(jd: number): Date {
  return new Date((jd - 2440587.5) * 86400000);
}
