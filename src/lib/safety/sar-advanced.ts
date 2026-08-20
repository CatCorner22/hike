import { formatUsng } from "@/lib/safety/usng";
import { formatZulu } from "@/lib/safety/landnav";
import { rangeAzimuth } from "@/lib/safety/landnav";
import type { SafetyWaypoint } from "@/lib/safety/profile";

export function saluteReport(input: {
  size?: string;
  activity?: string;
  lat?: number;
  lng?: number;
  unit?: string;
  time?: string;
  equipment?: string;
}): string {
  return [
    "SALUTE (hazard / SAR intel)",
    `S — Size: ${input.size ?? "unknown party / object"}`,
    `A — Activity: ${input.activity ?? "unknown"}`,
    `L — Location: ${input.lat != null && input.lng != null ? formatUsng(input.lat, input.lng) : "UNKNOWN"}`,
    `U — Unit/ID: ${input.unit ?? "civilian hikers"}`,
    `T — Time: ${input.time ?? formatZulu()}`,
    `E — Equipment: ${input.equipment ?? "none noted"}`,
  ].join("\n");
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
  return [
    "5-LINE HELO / SAR INBOUND",
    `L1 LZ GRID: ${loc}`,
    `L2 ELEV: ${input.elevationFt != null ? `${Math.round(input.elevationFt)} ft MSL` : "estimate from GPS"}`,
    `L3 WIND / OBST: ${input.wind ?? "unknown"} · ${input.obstacles ?? "trees, slope — scout on foot"}`,
    `L4 FRIENDLIES: ${input.friendlies ?? "hikers on ground, stay 100 m from rotors"}`,
    `L5 MARK: ${input.marking ?? "strobe, panel, smoke, arms Y"}`,
  ].join("\n");
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

/**
 * A hand-carried litter needs six carriers to lift at all, and realistically twelve or
 * more to rotate over any distance. The party size is not the carrier count: the casualty
 * cannot carry, and someone has to stay on their airway and monitor them.
 */
export const MIN_LITTER_CARRIERS = 6;

export interface LitterEvacAdvice {
  /** Can this party actually carry, or is the honest answer "shelter and send for help"? */
  feasible: boolean;
  carriers: number;
  hours: number | null;
  message: string;
}

export function litterEvacAdvice(distanceM: number, partySize = 2): LitterEvacAdvice {
  const party = Number.isFinite(partySize) ? Math.max(0, Math.floor(partySize)) : 0;
  const metres = Number.isFinite(distanceM) ? Math.max(0, distanceM) : 0;
  // One casualty plus one attendant on the airway; everyone else can take a handle.
  const carriers = Math.max(0, party - 2);

  if (carriers < MIN_LITTER_CARRIERS) {
    return {
      feasible: false,
      carriers,
      hours: null,
      message:
        `${carriers} available carrier${carriers === 1 ? "" : "s"} — a litter carry needs at least ` +
        `${MIN_LITTER_CARRIERS} to lift and about twice that to rotate. Do not attempt to move ` +
        `them: shelter in place, insulate from the ground, and send for help. Dropping a casualty ` +
        `or exhausting a carrier makes a second patient.`,
    };
  }

  // Conservative planning rates for a hand-carried litter on backcountry ground. Even a
  // full rotating team rarely beats 1 mph, and off-trail is far slower.
  const rateMph = carriers >= 12 ? 1 : carriers >= 8 ? 0.7 : 0.5;
  const hours = metres / 1609 / rateMph;
  const forDistance = `${Math.round(metres)} m with ${carriers} carriers`;
  const time = hours < 1 ? `~${Math.round(hours * 60)} min` : `~${hours.toFixed(1)} h`;
  return {
    feasible: true,
    carriers,
    hours,
    message:
      `Litter carry ${time} for ${forDistance}, on a good surface. Swap carriers every few ` +
      `minutes, and expect it to take far longer off-trail, in snow, or on steep ground.`,
  };
}

export function litterEvacTime(distanceM: number, partySize = 2): string {
  return litterEvacAdvice(distanceM, partySize).message;
}
