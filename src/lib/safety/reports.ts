import { formatUsng } from "@/lib/safety/usng";
import { formatZulu } from "@/lib/safety/landnav";
import type { IceProfile } from "@/lib/safety/profile";
import { formatReport, reportField } from "@/lib/safety/report-field";

export function sitrep(input: {
  lat?: number;
  lng?: number;
  trailName?: string;
  profile?: IceProfile | null;
  status?: string;
  action?: string;
  needs?: string;
  stale?: boolean;
}): string {
  const grid = input.lat != null && input.lng != null ? formatUsng(input.lat, input.lng) : null;
  // A null grid (non-finite or off the UTM band) used to interpolate as the
  // literal "null (LAST KNOWN)" into a SITREP read over the radio.
  const loc = grid
    ? `${grid}${input.stale ? " (LAST KNOWN)" : ""}`
    : input.lat != null && input.lng != null
      ? `NO GRID — LAT/LONG ${input.lat.toFixed(5)} ${input.lng.toFixed(5)}${input.stale ? " (LAST KNOWN)" : ""}`
      : "UNKNOWN";
  const who = input.profile?.name || "Hiker";
  const party = input.profile?.partySize ?? 1;
  return formatReport([
    "SITREP",
    `DTG: ${formatZulu()}`,
    `FROM: ${reportField(who)} / party ${reportField(party)}`,
    `LOC: ${reportField(loc)}`,
    input.trailName ? `ROUTE: ${reportField(input.trailName)}` : "",
    `STATUS: ${reportField(input.status ?? "OK — mobile")}`,
    `ACTION: ${reportField(input.action ?? "Staying put / continuing planned route")}`,
    `NEEDS: ${reportField(input.needs ?? "None")}`,
    input.profile?.medical ? `MEDICAL: ${reportField(input.profile.medical)}` : "",
    input.profile?.bloodType ? `BLOOD: ${reportField(input.profile.bloodType)}` : "",
  ]);
}

export function mistReport(input: {
  mechanism?: string;
  injuries?: string;
  signs?: string;
  treatment?: string;
  lat?: number;
  lng?: number;
}): string {
  return formatReport([
    "MIST (handoff)",
    `M — Mechanism: ${reportField(input.mechanism ?? "not stated")}`,
    `I — Injuries: ${reportField(input.injuries ?? "not stated")}`,
    `S — Signs: ${reportField(input.signs ?? "alert / breathing not stated")}`,
    `T — Treatment given: ${reportField(input.treatment ?? "none stated")}`,
    input.lat != null && input.lng != null ? `LOC: ${reportField(formatUsng(input.lat, input.lng))}` : "",
  ]);
}

export function marchCard(): string[] {
  return [
    "M — Massive bleeding: pressure, pack the wound, tourniquet high on a limb if needed.",
    "A — Airway: can they talk? If not, open and keep it open.",
    "R — Respirations: sit up if you can; seal a sucking chest wound.",
    "C — Circulation: stop more bleeding, keep them lying down if shocky.",
    "H — Hypothermia / head: pad under them, hat, wind shirt — cold kills the injured.",
  ];
}

export function groundToAirSignals(): string[] {
  return [
    "V — require assistance",
    "X — require medical assistance",
    "N — no / negative",
    "Y — yes / affirmative",
    "↑ — proceeding this direction",
    "SOS — distress (3 short, 3 long, 3 short)",
    "Make letters at least 3 m, contrasting, and keep them until rescuers wave you off.",
  ];
}

export function sarFrequencies(): string[] {
  return [
    "406 MHz digital PLB / EPIRB — register it; this phone is not a beacon.",
    "121.5 MHz homing / voice near a 406 hit (aircraft).",
    "Marine VHF 16 (156.800 MHz) if you are on water with a radio.",
    "A rented inReach / Garmin / Zoleo beats SMS when there is no cell.",
  ];
}

export type ImsafeFlag = "illness" | "meds" | "stress" | "alcohol" | "fatigue" | "emotion";

export function imsafeWarning(flags: ImsafeFlag[]): string | null {
  if (!Array.isArray(flags) || flags.length === 0) return null;
  const labels: Record<ImsafeFlag, string> = {
    illness: "illness",
    meds: "medication",
    stress: "stress",
    alcohol: "alcohol/drugs",
    fatigue: "fatigue",
    emotion: "emotion",
  };
  if (flags.some((flag) => !Object.hasOwn(labels, flag))) return null;
  return `IMSAFE: ${flags.map((f) => labels[f]).join(", ")} — pick an easier plan or stay put.`;
}
