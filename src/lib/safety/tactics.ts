import { sunPosition } from "@/lib/safety/astro";
import { formatUsng } from "@/lib/safety/usng";
import { formatReport, reportField } from "@/lib/safety/report-field";

/** Analog-watch sun compass. hour = 0–23 local. */
export function watchMethodHeading(
  hourLocal: number,
  hemisphere: "north" | "south",
): { toward: "N" | "S"; clockAzimuthFrom12: number; hint: string } | null {
  if (!Number.isFinite(hourLocal) || hourLocal < 0 || hourLocal > 24 || (hemisphere !== "north" && hemisphere !== "south")) return null;
  const h = ((hourLocal % 24) + 24) % 24;
  const hourOn12 = ((h % 12) + (h % 1)) * 30; // 0° = 12 o'clock
  const mid = hemisphere === "north" ? hourOn12 / 2 : (hourOn12 + 360) / 2;
  if (hemisphere === "north") {
    return {
      toward: "S",
      clockAzimuthFrom12: mid,
      hint: `Point the hour hand at the sun. Halfway to 12 is south (~${Math.round(mid)}° from 12 on the watch).`,
    };
  }
  return {
    toward: "N",
    clockAzimuthFrom12: mid,
    hint: `Point 12 at the sun. Halfway to the hour hand is north.`,
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

/** Rough grid convergence (true minus grid), degrees. East-positive longitude. */
export function gridConvergence(lat: number, lng: number): number | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  const zone = Math.floor((lng + 180) / 6) + 1;
  const central = -183 + zone * 6;
  return (lng - central) * Math.sin((lat * Math.PI) / 180);
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
  if (input.canWalk && (input.remainingM ?? 0) <= 1500 && (input.partySize ?? 1) >= 2) {
    return {
      choice: "walk-out",
      medicalPriority: false,
      reason: "Ambulatory and close — slow walk-out on the packed route with a buddy.",
    };
  }
  if (input.canWalk && (input.remainingM ?? 99999) > 1500) {
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

export function sunVsWatchCheck(
  date: Date,
  lat: number,
  lng: number,
  localHour: number,
): string | null {
  const sun = sunPosition(date, lat, lng);
  if (!sun || sun.elevation < 8) return null;
  const hemi = lat >= 0 ? "north" : "south";
  const watch = watchMethodHeading(localHour, hemi);
  if (!watch) return null;
  return `Watch method: ${watch.hint} Sun ephemeris ${Math.round(sun.azimuth)}° true — they should agree within ~20°.`;
}

/** 9 beads × 100 m = 1 km. Returns how many km completed plus leftover beads. */
export function paceBeads(totalHundreds: number): { km: number; beads: number; label: string } {
  if (!Number.isFinite(totalHundreds) || totalHundreds < 0 || totalHundreds > 10_000) {
    return { km: 0, beads: 0, label: "Cannot determine — verify your pace-bead input." };
  }
  const n = Math.floor(totalHundreds);
  const km = Math.floor(n / 9);
  const beads = n % 9;
  return { km, beads, label: `${km} km + ${beads} beads (×100 m)` };
}
