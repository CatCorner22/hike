import * as turf from "@turf/turf";
import { magneticDeclination, toMagneticBearing } from "@/lib/safety/declination";

/** NATO mils: 6400 mils in a circle. */
export function degreesToMils(degrees: number): number {
  return Math.round(((((degrees % 360) + 360) % 360) * 6400) / 360);
}

export function milsToDegrees(mils: number): number {
  return (((mils % 6400) + 6400) % 6400) * (360 / 6400);
}

export function backAzimuth(degrees: number): number {
  return (((degrees + 180) % 360) + 360) % 360;
}

export interface RangeAzimuth {
  meters: number;
  trueDeg: number;
  magneticDeg: number | null;
  mils: number;
  backTrueDeg: number;
  backMils: number;
}

export function rangeAzimuth(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): RangeAzimuth {
  const meters = turf.distance(
    turf.point([from.lng, from.lat]),
    turf.point([to.lng, to.lat]),
    { units: "meters" },
  );
  const trueDeg = (turf.bearing(turf.point([from.lng, from.lat]), turf.point([to.lng, to.lat])) + 360) % 360;
  const dec = magneticDeclination(from.lat, from.lng);
  const magneticDeg = dec == null ? null : toMagneticBearing(trueDeg, dec);
  return {
    meters,
    trueDeg,
    magneticDeg,
    mils: degreesToMils(trueDeg),
    backTrueDeg: backAzimuth(trueDeg),
    backMils: degreesToMils(backAzimuth(trueDeg)),
  };
}

export function deadReckon(
  start: { lat: number; lng: number },
  headingTrue: number,
  distanceM: number,
): { lat: number; lng: number } {
  const dest = turf.destination(
    turf.point([start.lng, start.lat]),
    distanceM,
    headingTrue,
    { units: "meters" },
  );
  return { lat: dest.geometry.coordinates[1], lng: dest.geometry.coordinates[0] };
}

export function distanceFromPaces(paces: number, pacesPer100m: number): number {
  if (pacesPer100m <= 0) return 0;
  return (paces / pacesPer100m) * 100;
}

export function formatZulu(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}Z ${date.getUTCDate()} ${monthCode(date.getUTCMonth())} ${date.getUTCFullYear()}`;
}

function monthCode(month: number) {
  return ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][
    month
  ];
}

export function formatRangeAzimuth(ra: RangeAzimuth): string {
  const mag =
    ra.magneticDeg != null ? ` / ${Math.round(ra.magneticDeg)}° mag` : "";
  return `${Math.round(ra.meters)} m · ${Math.round(ra.trueDeg)}° true (${ra.mils} mils)${mag} · back ${Math.round(ra.backTrueDeg)}°`;
}
