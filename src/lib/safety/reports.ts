import { formatUsng } from "@/lib/safety/usng";
import { formatZulu } from "@/lib/safety/landnav";
import type { IceProfile } from "@/lib/safety/profile";

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
  const loc =
    input.lat != null && input.lng != null
      ? `${formatUsng(input.lat, input.lng)}${input.stale ? " (LAST KNOWN)" : ""}`
      : "UNKNOWN";
  const who = input.profile?.name || "Hiker";
  const party = input.profile?.partySize ?? 1;
  return [
    "SITREP",
    `DTG: ${formatZulu()}`,
    `FROM: ${who} / party ${party}`,
    `LOC: ${loc}`,
    input.trailName ? `ROUTE: ${input.trailName}` : "",
    `STATUS: ${input.status ?? "OK — mobile"}`,
    `ACTION: ${input.action ?? "Staying put / continuing planned route"}`,
    `NEEDS: ${input.needs ?? "None"}`,
    input.profile?.medical ? `MEDICAL: ${input.profile.medical}` : "",
    input.profile?.bloodType ? `BLOOD: ${input.profile.bloodType}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function mistReport(input: {
  mechanism?: string;
  injuries?: string;
  signs?: string;
  treatment?: string;
  lat?: number;
  lng?: number;
}): string {
  return [
    "MIST (handoff)",
    `M — Mechanism: ${input.mechanism ?? "not stated"}`,
    `I — Injuries: ${input.injuries ?? "not stated"}`,
    `S — Signs: ${input.signs ?? "alert / breathing not stated"}`,
    `T — Treatment given: ${input.treatment ?? "none stated"}`,
    input.lat != null && input.lng != null ? `LOC: ${formatUsng(input.lat, input.lng)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
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
  if (flags.length === 0) return null;
  const labels: Record<ImsafeFlag, string> = {
    illness: "illness",
    meds: "medication",
    stress: "stress",
    alcohol: "alcohol/drugs",
    fatigue: "fatigue",
    emotion: "emotion",
  };
  return `IMSAFE: ${flags.map((f) => labels[f]).join(", ")} — pick an easier plan or stay put.`;
}
