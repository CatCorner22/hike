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

/**
 * A hand-carried litter needs six carriers to lift at all, and realistically twelve or
 * more to rotate over any distance. The party size is not the carrier count: the casualty
 * cannot carry, and someone has to stay on their airway and monitor them.
 */
export const MIN_LITTER_CARRIERS = 6;
/**
 * Above this the input is not a hiking party, it is corrupt data. A party size
 * of 1e9 previously yielded a confident "~37 min for 1000 m with 999999998
 * carriers", which reads as authoritative while proving the input was garbage.
 */
export const MAX_PLAUSIBLE_PARTY = 200;

export interface LitterEvacAdvice {
  /** Can this party actually carry, or is the honest answer "shelter and send for help"? */
  feasible: boolean;
  carriers: number;
  hours: number | null;
  message: string;
}

<<<<<<< HEAD
export function litterEvacAdvice(distanceM: number, partySize = 2): LitterEvacAdvice {
  const party = Number.isFinite(partySize) ? Math.max(0, Math.floor(partySize)) : 0;
  // Clamping a non-finite or negative distance to 0 produced a confident
  // "Litter carry ~0 min for 0 m" from garbage input -- the worst possible
  // answer, because a party would read it as "this is trivial, start walking".
  // An unknown distance is refused instead.
  if (Number.isFinite(partySize) && partySize > MAX_PLAUSIBLE_PARTY) {
    return {
      feasible: false,
      carriers: 0,
      hours: null,
      message:
        `A party size of ${Math.floor(partySize)} is not a plausible field input, so no carry ` +
        "time is given. Re-enter the number of people actually present.",
    };
  }
  if (!Number.isFinite(distanceM) || distanceM < 0) {
    return {
      feasible: false,
      carriers: Math.max(0, party - 2),
      hours: null,
      message:
        "Distance to the evacuation point is unknown, so no carry time can be given. " +
        "Do not plan a litter carry on a guess: fix the position first, or shelter in " +
        "place and send for help.",
    };
  }
=======
const MAX_LITTER_DISTANCE_M = 100_000;
const MAX_LITTER_PARTY = 50;

function isSaneLitterInput(distanceM: number, partySize: number): boolean {
  return (
    Number.isFinite(distanceM) &&
    distanceM > 0 &&
    distanceM <= MAX_LITTER_DISTANCE_M &&
    Number.isFinite(partySize) &&
    partySize >= 1 &&
    partySize <= MAX_LITTER_PARTY
  );
}

export function litterEvacAdvice(distanceM: number, partySize = 2): LitterEvacAdvice | null {
  if (!isSaneLitterInput(distanceM, partySize)) return null;
  const party = Math.floor(partySize);
>>>>>>> origin/main
  const metres = distanceM;
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

export function litterEvacTime(distanceM: number, partySize = 2): string | null {
  return litterEvacAdvice(distanceM, partySize)?.message ?? null;
}
