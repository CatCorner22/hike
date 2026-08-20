import { formatUsng } from "@/lib/safety/usng";
import { formatZulu } from "@/lib/safety/landnav";
import type { IceProfile } from "@/lib/safety/profile";
import { formatReport, reportField } from "@/lib/safety/report-field";

/** SMEAC — five-paragraph field order, civilian hike / SAR. */
export function smeacBrief(input: {
  trailName?: string;
  lat?: number;
  lng?: number;
  returnAt?: string;
  profile?: IceProfile | null;
  mission?: string;
  execution?: string;
  admin?: string;
  command?: string;
}): string {
  const loc =
    input.lat != null && input.lng != null ? formatUsng(input.lat, input.lng) : "UNKNOWN";
  const party = input.profile?.partySize ?? 1;
  return formatReport([
    "SMEAC — FIELD BRIEF",
    `DTG: ${formatZulu()}`,
    `S — SITUATION: ${reportField(input.trailName ?? "wilderness route")} · now ${reportField(loc)} · party ${reportField(party)}`,
    `M — MISSION: ${reportField(input.mission ?? "Complete planned hike and return by overdue time; send SOS if overdue or injured.")}`,
    `E — EXECUTION: ${reportField(input.execution ?? "Stay on packed route. Handrail trail. Rally at last RP / LKP if split.")}`,
    `A — ADMIN/LOG: ${reportField(input.admin ?? "Water, layers, headlamp, SOS sheet on this phone. ICE filled.")}${input.returnAt ? ` Return ${reportField(input.returnAt)}` : ""}`,
    `C — COMMAND/SIGNAL: ${reportField(input.command ?? "PACE: SMS ICE → share grid → voice 9-line → stay put + beacon. Challenge/password if night regroup.")}`,
    input.profile?.iceName || input.profile?.icePhone
      ? `ICE: ${reportField(input.profile?.iceName, 100)} ${reportField(input.profile?.icePhone, 100)}`
      : "",
  ]);
}

/** ACE-lite for a hiking party: water, casualties, equipment — not ammo. */
export function aceReport(input: {
  waterLiters?: number;
  injured?: number;
  partySize?: number;
  gearNote?: string;
  lat?: number;
  lng?: number;
}): string {
  const party = input.partySize ?? 1;
  const injured = input.injured ?? 0;
  const water = input.waterLiters;
  return formatReport([
    "ACE (party status)",
    `A — Assets/water: ${water != null ? `${water} L remaining` : "water not logged"}`,
    `C — Casualties: ${injured} of ${party} injured / non-ambulatory`,
    `E — Equipment: ${reportField(input.gearNote ?? "headlamp, shelter, comms as packed")}`,
    input.lat != null && input.lng != null ? `LOC: ${reportField(formatUsng(input.lat, input.lng))}` : "",
  ]);
}

export function leapfrogSop(): string[] {
  return [
    "Leapfrog (bounding) for poor visibility or kids:",
    "Team A holds a visible rally (tree, cairn, RP).",
    "Team B walks a short, timed leg on a known heading / handrail.",
    "Team B stops, signals (whistle 1 = OK), becomes the new hold.",
    "Never both teams moving if you cannot see or hear each other.",
    "Lost contact: last hold is the ORP — do not chase.",
  ];
}

export function rallySop(): string[] {
  return [
    "Rally / ORP: last marked RP, LKP, or camp.",
    "Wait 30 min at the last known rally before moving.",
    "Leave a note: time, direction, party status, next rally.",
    "Night: stay at the rally unless the site is dangerous.",
    "Challenge (optional): a word you agreed at trailhead — answer is the other word.",
  ];
}

export function fieldMetar(input: {
  sky?: "CLR" | "FEW" | "SCT" | "BKN" | "OVC";
  windKph?: number;
  visKm?: number;
  precip?: string;
  lat?: number;
  lng?: number;
}): string {
  const sky = input.sky ?? "UNK";
  const wind = input.windKph != null ? `${Math.round(input.windKph)}KPH` : "WIND UNK";
  const vis = input.visKm != null ? `VIS ${input.visKm}KM` : "VIS UNK";
  const loc = input.lat != null && input.lng != null ? formatUsng(input.lat, input.lng) : "";
  return formatReport([[`FIELD OBS ${formatZulu()}`, sky, wind, vis, reportField(input.precip ?? "PCPN UNK"), loc].filter(Boolean).join(" ")]);
}
