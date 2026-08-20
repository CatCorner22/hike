import { formatUsng } from "@/lib/safety/usng";
import { formatZulu } from "@/lib/safety/landnav";
import { rangeAzimuth } from "@/lib/safety/landnav";
import type { SafetyWaypoint } from "@/lib/safety/profile";
import { formatReport, reportField } from "@/lib/safety/report-field";

export function saluteReport(input: {
  size?: string;
  activity?: string;
  lat?: number;
  lng?: number;
  unit?: string;
  time?: string;
  equipment?: string;
}): string {
  return formatReport([
    "SALUTE (hazard / SAR intel)",
    `S — Size: ${reportField(input.size ?? "unknown party / object")}`,
    `A — Activity: ${reportField(input.activity ?? "unknown")}`,
    `L — Location: ${reportField(input.lat != null && input.lng != null ? formatUsng(input.lat, input.lng) : "UNKNOWN")}`,
    `U — Unit/ID: ${reportField(input.unit ?? "civilian hikers")}`,
    `T — Time: ${reportField(input.time ?? formatZulu())}`,
    `E — Equipment: ${reportField(input.equipment ?? "none noted")}`,
  ]);
}

export function fiveLineHeloBrief(input: {
  lat?: number;
  lng?: number;
  wind?: string;
  obstacles?: string;
  friendlies?: string;
  marking?: string;
  elevationFt?: number;
}): string {
  const loc =
    input.lat != null && input.lng != null ? formatUsng(input.lat, input.lng) : "UNKNOWN";
  return formatReport([
    "5-LINE HELO / SAR INBOUND",
    `L1 LZ GRID: ${reportField(loc)}`,
    `L2 ELEV: ${reportField(input.elevationFt != null && Number.isFinite(input.elevationFt) ? `${Math.round(input.elevationFt)} ft MSL` : "estimate from GPS")}`,
    `L3 WIND / OBST: ${reportField(input.wind ?? "unknown")} · ${reportField(input.obstacles ?? "trees, slope — scout on foot")}`,
    `L4 FRIENDLIES: ${reportField(input.friendlies ?? "hikers on ground, stay 100 m from rotors")}`,
    `L5 MARK: ${reportField(input.marking ?? "strobe, panel, smoke, arms Y")}`,
  ]);
}

export function lzAssessmentChecklist(): string[] {
  return [
    "Slope ≤ 8° (helo skids) — walk it if unsure",
    "Clear rotor disk: no snags, wires, or loose gear within 2 rotor spans",
    "Firm surface — no deep snow sink / swamp",
    "One approach, one departure — mark wind with streamer or dust",
    "Party stays low, no running toward the aircraft",
    "Secure packs, hats, and loose items before touchdown",
  ];
}

export { sereStayPutCard } from "@/lib/safety/sere";

export function commsWindowReminder(lastAttemptAt: number | null, now = Date.now()): string | null {
  const interval = 15 * 60_000;
  if (lastAttemptAt == null) return "Try SMS / share at each rest stop (every ~15 min on a hard hike).";
  const elapsed = now - lastAttemptAt;
  if (elapsed < interval) return null;
  return `No comms attempt in ${Math.round(elapsed / 60_000)} min — try SMS, share, or 911 on the next ridge.`;
}

const RALLY_KINDS = new Set<SafetyWaypoint["kind"]>(["rp", "orp", "lkp", "camp"]);

export function buddySeparationWarning(
  here: { lat: number; lng: number },
  waypoints: SafetyWaypoint[],
  maxM = 200,
): string | null {
  const rallies = waypoints.filter((w) => RALLY_KINDS.has(w.kind));
  if (rallies.length === 0) return null;
  let best: { meters: number; kind: string } | null = null;
  for (const wp of rallies) {
    const meters = rangeAzimuth(here, wp).meters;
    if (!best || meters < best.meters) best = { meters, kind: wp.kind.toUpperCase() };
  }
  if (!best || best.meters <= maxM) return null;
  return `${Math.round(best.meters)} m from last ${best.kind} — regroup or mark this split on the nav log.`;
}

export function litterEvacTime(distanceM: number, partySize = 2): string | null {
  if (!Number.isFinite(distanceM) || distanceM <= 0 || distanceM > 100_000 || !Number.isInteger(partySize) || partySize < 2 || partySize > 20) return null;
  const rateMph = partySize >= 4 ? 1.2 : partySize >= 2 ? 0.8 : 0.5;
  const hours = distanceM / 1609 / rateMph;
  if (hours < 1) return `Litter carry ~${Math.round(hours * 60)} min for ${Math.round(distanceM)} m (rough).`;
  return `Litter carry ~${hours.toFixed(1)} h for ${Math.round(distanceM)} m — plan relays and swap carriers.`;
}
