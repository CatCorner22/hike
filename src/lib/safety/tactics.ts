import { sunPosition } from "@/lib/safety/astro";
import { gridConvergence } from "@/lib/safety/declination";
import { formatUsng } from "@/lib/safety/usng";
import { formatReport, reportField } from "@/lib/safety/report-field";

/**
 * Local apparent solar hour (0-24) from longitude.
 *
 * The watch method assumes the watch reads solar time. A device clock reads zone time
 * plus daylight saving, and one hour of error is 30 deg on the dial — halved into 15 deg
 * of heading error, in the season when most people are out. Deriving the hour from
 * longitude removes both the DST and the zone-offset error.
 */
export function solarHour(date: Date, lng: number): number {
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  return ((utcHours + lng / 15) % 24 + 24) % 24;
}

/**
 * Analog-watch sun compass. `hourSolar` is local *solar* time (see `solarHour`).
 *
 * The bisector must be taken across the SMALLER arc between the hour hand and the 12
 * mark, and which arc that is depends on morning versus afternoon — not on where the
 * hour hand happens to sit relative to the 180 deg mark. Both readings collapse to one
 * dial angle: 15 deg per solar hour, plus half a turn. It is the same angle in both
 * hemispheres; only which hand you aim at the sun, and whether the bisector reads south
 * or north, differ.
 *
 * This has been wrong twice. First `hourOn12 / 2` unconditionally, which pointed
 * backwards for northern mornings and southern afternoons. Then the `hourOn12 > 180`
 * branch, which is right from 06:00 to 18:00 solar and 180 deg wrong outside it — live
 * in high-latitude summer, where the sun is well up at 05:00 and 20:00. On a method you
 * reach for precisely because you have no compass, either one sends people the wrong way
 * down the wrong drainage.
 */
export function watchMethodHeading(
  hourSolar: number,
  hemisphere: "north" | "south",
): { toward: "N" | "S"; clockAzimuthFrom12: number; hint: string } | null {
  if (!Number.isFinite(hourSolar) || hourSolar < 0 || hourSolar > 24 || (hemisphere !== "north" && hemisphere !== "south")) return null;
  const h = ((hourSolar % 24) + 24) % 24;
  // The bisector sits where the sun-referenced pole falls, which is 15 deg per hour
  // from the 12 mark plus half a turn — the same dial angle in both hemispheres.
  //
  // Picking the branch on `hourOn12 > 180` instead only agrees with that between
  // 06:00 and 18:00 solar. Outside those hours it lands on the opposite arc and the
  // hint points 180 deg wrong: at Anchorage on 21 June at 05:30 solar, with the sun
  // already 17 deg up, it called azimuth 349 deg "south". The test that covered this
  // sampled 06:30-17:30 only, which is exactly the window where the old branch works.
  const mid = ((15 * h + 180) % 360 + 360) % 360;
  const clock = `~${Math.round(mid)}° clockwise from the 12 mark`;

  if (hemisphere === "north") {
    return {
      toward: "S",
      clockAzimuthFrom12: mid,
      hint: `Point the hour hand at the sun. Midway between the hour hand and 12 — the short way round, ${clock} — is south.`,
    };
  }
  return {
    toward: "N",
    clockAzimuthFrom12: mid,
    hint: `Point the 12 mark at the sun. Midway between 12 and the hour hand — the short way round, ${clock} — is north.`,
  };
}

export function polarisHint(lat: number): string | null {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return null;
  if (lat >= 5) {
    return `Polaris is ~${Math.round(lat)}° above the northern horizon (your latitude). Face it = true north.`;
  }
  if (lat <= -5) {
    return "Southern Cross: long axis through the pointers, extend 4.5 lengths — that is the south celestial pole.";
  }
  return "Near the equator both poles are low. Use the sun / moon compass instead.";
}

export function formatGmtCard(trueDeg: number, magneticDeg: number | null, lat: number, lng: number): string | null {
  const conv = gridConvergence(lat, lng);
  if (conv == null || !Number.isFinite(trueDeg) || trueDeg < 0 || trueDeg >= 360 || (magneticDeg != null && (!Number.isFinite(magneticDeg) || magneticDeg < 0 || magneticDeg >= 360))) return null;
  const grid = ((trueDeg - conv) % 360 + 360) % 360;
  const mag = magneticDeg != null ? ` · ${Math.round(magneticDeg)}° mag` : "";
  return `${Math.round(trueDeg)}° true · ${Math.round(grid)}° grid (conv ${conv >= 0 ? "+" : ""}${conv.toFixed(1)}°)${mag}`;
}

export type CasevacChoice = "stay" | "short-carry" | "walk-out";
export type MedicalOverride = "severe-altitude-illness" | "uncontrolled-hemorrhage" | "airway-compromise" | "severe-hypothermia";

export function casevacDecision(input: {
  injured: boolean;
  canWalk: boolean;
  isDark: boolean;
  remainingM?: number;
  partySize?: number;
  medicalOverride?: MedicalOverride;
}): { choice: CasevacChoice | "urgent-assisted-descent"; reason: string; medicalPriority: boolean } {
  if (input.medicalOverride) {
    const labels: Record<MedicalOverride, string> = {
      "severe-altitude-illness": "severe altitude illness",
      "uncontrolled-hemorrhage": "uncontrolled hemorrhage",
      "airway-compromise": "airway compromise",
      "severe-hypothermia": "severe hypothermia",
    };
    return {
      choice: "urgent-assisted-descent",
      medicalPriority: true,
      reason: `MEDICAL PRIORITY: ${labels[input.medicalOverride]} requires urgent assisted descent/evacuation and rescue activation. The generic stay-put rule does not apply; move only as terrain safety permits while arranging rescue.`,
    };
  }
  if (input.injured && !input.canWalk) {
    return {
      choice: "stay",
      medicalPriority: false,
      reason: "Non-walker — stay put, signal, send 9-line / MIST. Litter only if the site is immediately dangerous.",
    };
  }
  if (input.isDark && input.injured) {
    return {
      choice: "stay",
      medicalPriority: false,
      reason: "Injured after dark — shelter and signal. Move at first light unless fire/flood/lightning.",
    };
  }
  // The two distance branches used to default a missing `remainingM` in opposite
  // directions — 0 in the first, 99999 in the second — so an unknown distance took
  // the first branch and was reported as "Ambulatory and close". The panel passes an
  // optional prop that is undefined whenever the route has not been matched, which is
  // exactly when a party is most likely to be lost.
  const remainingM = Number.isFinite(input.remainingM) ? (input.remainingM as number) : null;
  if (remainingM == null && input.canWalk) {
    return input.injured
      ? {
          choice: "stay",
          medicalPriority: false,
          reason:
            "Ambulatory, but the distance out is not known — do not start an unmeasured walk-out with an injury. Fix your position (grid or resection), then decide.",
        }
      : {
          choice: "walk-out",
          medicalPriority: false,
          reason:
            "Ambulatory, distance out NOT measured — walk out on the packed route, and confirm the remaining distance before committing to a long leg.",
        };
  }
  if (input.canWalk && remainingM != null && remainingM <= 1500 && (input.partySize ?? 1) >= 2) {
    return {
      choice: "walk-out",
      medicalPriority: false,
      reason: `Ambulatory and close (~${Math.round(remainingM)} m) — slow walk-out on the packed route with a buddy.`,
    };
  }
  if (input.canWalk && remainingM != null && remainingM > 1500) {
    return {
      choice: "short-carry",
      medicalPriority: false,
      reason: "Long way yet — consider a short assisted move to a better LZ / handrail, then stay.",
    };
  }
  return { choice: "stay", medicalPriority: false, reason: "Default: stay, improve shelter, run beacon." };
}

export function fordSop(): string[] {
  return [
    "Scout up and down — never the first smooth-looking slot.",
    "Unbuckle pack hip belt. Pole upstream. Side-step, face the current.",
    "Knee-deep + fast = too deep. Turn around.",
    "One at a time; spotter downstream with a throw line if you have one.",
    "After: dry feet, dry socks — wet feet become a SERE problem.",
  ];
}

export function nightMovementSop(): string[] {
  return [
    "Red light only near other people / wildlife. White for map checks, then off.",
    "Short legs, catching features, pace beads every 100 m.",
    "No cliff bands, no creek crossings you did not scout in daylight.",
    "If you lose the handrail: halt, last known, 3-blast, do not fan out.",
    "Moon + NVG/red mode on this phone — still trust the compass over the glow.",
  ];
}

export function lostPersonQuery(input: {
  name?: string;
  lastSeen?: string;
  clothing?: string;
  direction?: string;
  medical?: string;
  lat?: number;
  lng?: number;
}): string {
  return formatReport([
    "LOST PERSON QUERY (for 911 / SAR)",
    `Name: ${reportField(input.name ?? "unknown")}`,
    `Last seen: ${reportField(input.lastSeen ?? "not stated")}`,
    `Clothing: ${reportField(input.clothing ?? "not stated")}`,
    `Direction of travel: ${reportField(input.direction ?? "unknown")}`,
    `Medical: ${reportField(input.medical ?? "unknown")}`,
    input.lat != null && input.lng != null ? `Your grid now: ${reportField(formatUsng(input.lat, input.lng))}` : "",
    "Stay on the line. Do not have the whole party search in different directions.",
  ]);
}

/**
 * Past this, the dial is not a direction aid any more — say so instead of dressing it up.
 */
const WATCH_DIAL_MAX_ERROR_DEG = 15;

/**
 * Sun compass for a phone that can still compute, which is the only situation in which
 * this string gets rendered at all.
 *
 * The watch method assumes the sun's azimuth sweeps a uniform 15 deg per hour. That
 * holds near the equinox and near the horizon, and badly fails in summer at
 * mid-latitude: measured against real ephemeris it is 38 deg out at Yosemite on
 * 21 June at 09:00 solar and 34 deg out in Patagonia on 21 December at 15:00 — while
 * being 2.8 deg out at the same Yosemite spot in December. Quoting the hint with no
 * indication of which day you are having sends a party down the wrong drainage.
 *
 * So lead with the shadow line, which is exact and needs no dial, and measure the dial
 * against it — the sun's true azimuth is right here, so the error is known, not guessed.
 */
export function sunVsWatchCheck(date: Date, lat: number, lng: number, localHour?: number): string | null {
  const sun = sunPosition(date, lat, lng);
  if (!sun || sun.elevation < 8) return null;
  const hemi = lat >= 0 ? "north" : "south";
  // Solar time, not the device clock: see `solarHour`. An explicit hour is accepted
  // for field checks; the dial angle is still not the same quantity as sun azimuth.
  const hour =
    localHour != null && Number.isFinite(localHour)
      ? (((localHour % 24) + 24) % 24 + date.getMinutes() / 60 + date.getSeconds() / 3600) % 24
      : solarHour(date, lng);
  const watch = watchMethodHeading(hour, hemi);
  if (!watch) return null;

  const shadowDeg = Math.round((sun.azimuth + 180) % 360);
  const shadowLine = `Sun bears ${Math.round(sun.azimuth)}° true, so your shadow points ${shadowDeg}° true — lay a stick along it and read directions off the shadow (do not compare the sun azimuth number to the watch-dial angle).`;

  // Where the bisector actually lands, given the real sun. North: the hour hand is
  // aimed at the sun, so the 12 mark trails it by the dial angle. South: the 12 mark
  // is the one aimed at the sun.
  const dialDeg = (hour % 12) * 30;
  const twelveMarkTrue = hemi === "north" ? ((sun.azimuth - dialDeg) % 360 + 360) % 360 : sun.azimuth;
  const bisectorTrue = (twelveMarkTrue + watch.clockAzimuthFrom12) % 360;
  const wanted = watch.toward === "S" ? 180 : 0;
  const dialErrorDeg = Math.abs((((bisectorTrue - wanted + 180) % 360) + 360) % 360 - 180);

  if (dialErrorDeg > WATCH_DIAL_MAX_ERROR_DEG) {
    return `${shadowLine} The watch method is ${Math.round(dialErrorDeg)}° out at this latitude and season — use the shadow, not the dial.`;
  }
  return `${shadowLine} Watch method: ${watch.hint} (dial runs ~${Math.round(dialErrorDeg)}° out here)`;
}

/**
 * Ranger pace counter: nine lower beads, one pulled every 100 m. The ninth bead is
 * 900 m — the kilometre bead goes across on the *tenth* hundred, and the lower nine
 * reset. So a kilometre is ten beads' worth of ground, not nine.
 *
 * Dividing by 9 turned 900 m into "1 km" and grew from there: 4 500 m read as
 * "5 km + 0 beads", and 10 km read as "11 km + 1 bead". That is an 11% overstatement
 * of distance walked, fed straight into a GPS-denied dead-reckoning position.
 */
export function paceBeads(totalHundreds: number): { km: number; beads: number; label: string } {
  if (!Number.isFinite(totalHundreds) || totalHundreds < 0 || totalHundreds > 10_000) {
    return { km: 0, beads: 0, label: "Cannot determine — verify your pace-bead input." };
  }
  const n = Math.floor(totalHundreds);
  const km = Math.floor(n / 10);
  const beads = n % 10;
  return { km, beads, label: `${km} km + ${beads} beads (×100 m) = ${n * 100} m` };
}
