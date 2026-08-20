import { sunPosition } from "@/lib/safety/astro";
import { gridConvergence } from "@/lib/safety/declination";
import { formatUsng } from "@/lib/safety/usng";

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
 * mark. Before noon the hour hand sits more than 180 deg clockwise of 12, so the smaller
 * arc is on the other side and the bisector is 180 deg away from `hourOn12 / 2`.
 *
 * The previous formula used `hourOn12 / 2` unconditionally for the northern hemisphere
 * and its reflex for the southern, which pointed exactly backwards for half of every day
 * in each: northern mornings and southern afternoons. On a method used precisely when
 * there is no compass, that sent people 180 deg wrong.
 *
 * The dial position is the same in both hemispheres; only which hand you aim at the sun,
 * and whether the bisector reads south or north, differ.
 */
export function watchMethodHeading(
  hourSolar: number,
  hemisphere: "north" | "south",
): { toward: "N" | "S"; clockAzimuthFrom12: number; hint: string } {
  const h = ((hourSolar % 24) + 24) % 24;
  const hourOn12 = (h % 12) * 30; // degrees clockwise from the 12 mark
  const mid = (hourOn12 / 2 + (hourOn12 > 180 ? 180 : 0)) % 360;
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

export function polarisHint(lat: number): string {
  if (lat >= 5) {
    return `Polaris is ~${Math.round(lat)}° above the northern horizon (your latitude). Face it = true north.`;
  }
  if (lat <= -5) {
    return "Southern Cross: long axis through the pointers, extend 4.5 lengths — that is the south celestial pole.";
  }
  return "Near the equator both poles are low. Use the sun / moon compass instead.";
}

export function formatGmtCard(trueDeg: number, magneticDeg: number | null, lat: number, lng: number): string {
  const conv = gridConvergence(lat, lng);
  const grid = ((trueDeg - conv) % 360 + 360) % 360;
  const mag = magneticDeg != null ? ` · ${Math.round(magneticDeg)}° mag` : "";
  return `${Math.round(trueDeg)}° true · ${Math.round(grid)}° grid (conv ${conv >= 0 ? "+" : ""}${conv.toFixed(1)}°)${mag}`;
}

export type CasevacChoice = "stay" | "short-carry" | "walk-out";

export function casevacDecision(input: {
  injured: boolean;
  canWalk: boolean;
  isDark: boolean;
  remainingM?: number;
  partySize?: number;
}): { choice: CasevacChoice; reason: string } {
  if (input.injured && !input.canWalk) {
    return {
      choice: "stay",
      reason: "Non-walker — stay put, signal, send 9-line / MIST. Litter only if the site is immediately dangerous.",
    };
  }
  if (input.isDark && input.injured) {
    return {
      choice: "stay",
      reason: "Injured after dark — shelter and signal. Move at first light unless fire/flood/lightning.",
    };
  }
  if (input.canWalk && (input.remainingM ?? 0) <= 1500 && (input.partySize ?? 1) >= 2) {
    return {
      choice: "walk-out",
      reason: "Ambulatory and close — slow walk-out on the packed route with a buddy.",
    };
  }
  if (input.canWalk && (input.remainingM ?? 99999) > 1500) {
    return {
      choice: "short-carry",
      reason: "Long way yet — consider a short assisted move to a better LZ / handrail, then stay.",
    };
  }
  return { choice: "stay", reason: "Default: stay, improve shelter, run beacon." };
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
  return [
    "LOST PERSON QUERY (for 911 / SAR)",
    `Name: ${input.name ?? "unknown"}`,
    `Last seen: ${input.lastSeen ?? "not stated"}`,
    `Clothing: ${input.clothing ?? "not stated"}`,
    `Direction of travel: ${input.direction ?? "unknown"}`,
    `Medical: ${input.medical ?? "unknown"}`,
    input.lat != null && input.lng != null ? `Your grid now: ${formatUsng(input.lat, input.lng)}` : "",
    "Stay on the line. Do not have the whole party search in different directions.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function sunVsWatchCheck(date: Date, lat: number, lng: number): string | null {
  const sun = sunPosition(date, lat, lng);
  if (!sun || sun.elevation < 8) return null;
  const hemi = lat >= 0 ? "north" : "south";
  // Solar time, not the device clock: see `solarHour`.
  const watch = watchMethodHeading(solarHour(date, lng), hemi);
  return `Watch method: ${watch.hint} Sun ephemeris ${Math.round(sun.azimuth)}° true — they should agree within ~20°.`;
}

/** 9 beads × 100 m = 1 km. Returns how many km completed plus leftover beads. */
export function paceBeads(totalHundreds: number): { km: number; beads: number; label: string } {
  const n = Math.max(0, Math.floor(totalHundreds));
  const km = Math.floor(n / 9);
  const beads = n % 9;
  return { km, beads, label: `${km} km + ${beads} beads (×100 m)` };
}
