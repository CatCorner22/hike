/** Approximate sunset time (UTC) for a lat/lng on a given date. */
export function estimateSunsetUtc(date: Date, lat: number, lng: number): Date {
  const day = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const start = day.getTime();
  const n = Math.round(start / 86400000) - 10957;
  const lngHour = lng / 15;
  const t = n - lngHour / 24;

  const m = 0.9856 * t - 3.289;
  let l =
    m +
    1.916 * sinDeg(m) +
    0.02 * sinDeg(2 * m) +
    282.634;
  l = normalizeDeg(l);
  let ra = atanDeg(0.91764 * tanDeg(l));
  ra = normalizeDeg(ra);
  const lQuadrant = Math.floor(l / 90) * 90;
  const raQuadrant = Math.floor(ra / 90) * 90;
  ra = (ra + (lQuadrant - raQuadrant)) / 15;

  const sinDec = 0.39782 * sinDeg(l);
  const cosDec = cosDeg(asinDeg(sinDec));

  const cosH =
    (cosDeg(90.833) - sinDec * sinDeg(lat)) / (cosDec * cosDeg(lat));

  if (cosH > 1 || cosH < -1) {
    return new Date(start + 12 * 3600000);
  }

  const h = normalizeDeg(acosDeg(cosH));
  const localMeanTime = h + ra - 0.06571 * t - 6.622;
  let ut = localMeanTime - lngHour;
  ut = ((ut % 24) + 24) % 24;

  return new Date(start + ut * 3600000);
}

export function minutesUntilSunset(date: Date, lat: number, lng: number): number {
  const sunset = estimateSunsetUtc(date, lat, lng);
  return Math.round((sunset.getTime() - date.getTime()) / 60000);
}

export function daylightWarning(minutesLeft: number): string | null {
  if (minutesLeft <= 0) return "Past sunset — use a headlamp and turn back if unsure.";
  if (minutesLeft <= 30) return `${minutesLeft} min until sunset — plan your turnaround.`;
  if (minutesLeft <= 60) return `${minutesLeft} min until sunset.`;
  return null;
}

function sinDeg(d: number) {
  return Math.sin((d * Math.PI) / 180);
}

function cosDeg(d: number) {
  return Math.cos((d * Math.PI) / 180);
}

function tanDeg(d: number) {
  return Math.tan((d * Math.PI) / 180);
}

function asinDeg(x: number) {
  return (Math.asin(x) * 180) / Math.PI;
}

function acosDeg(x: number) {
  return (Math.acos(x) * 180) / Math.PI;
}

function atanDeg(x: number) {
  return (Math.atan(x) * 180) / Math.PI;
}

function normalizeDeg(d: number) {
  return ((d % 360) + 360) % 360;
}
