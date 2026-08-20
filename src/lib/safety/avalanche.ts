import type { Severity } from "@/lib/safety/severity";

export const DISCLAIMER =
  "Training aid, not an avalanche forecast. It does not replace formal avalanche education (AIARE or equivalent), partner practice, or the current local avalanche center bulletin.";

export type AvalancheDanger = "low" | "moderate" | "considerable" | "high" | "extreme";

export interface AvalancheDangerScaleEntry {
  level: AvalancheDanger;
  likelihood: string;
  size: string;
  travelAdvice: string;
}

export interface AvalancheTerrainRisk {
  severity: Severity;
  message: string;
}

export interface AlptruthFactor {
  letter: string;
  factor: string;
  question: string;
}

export interface CompanionRescueTimelineEntry {
  minutes: string;
  survival: string;
  action: string;
}

export interface BeaconSearchPhase {
  phase: string;
  goal: string;
  technique: string;
}

export interface AvalancheAssessment {
  severity: Severity;
  snowGoNoGo: "go" | "caution" | "no-go";
  /** @deprecated Scope-specific snowGoNoGo is authoritative. This compatibility field never grants a global go. */
  goNoGo: "caution" | "no-go";
  reasons: string[];
  actions: string[];
}

const DANGER_LEVELS: AvalancheDanger[] = ["low", "moderate", "considerable", "high", "extreme"];

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}

function isAvalancheDanger(value: unknown): value is AvalancheDanger {
  return typeof value === "string" && DANGER_LEVELS.includes(value as AvalancheDanger);
}

function validProfile(profile: Array<{ distanceMeters: number; elevation: number }>): boolean {
  return (
    Array.isArray(profile) &&
    profile.length >= 2 &&
    profile.every(
      (point, index) =>
        Number.isFinite(point.distanceMeters) &&
        Number.isFinite(point.elevation) &&
        point.distanceMeters >= 0 &&
        (index === 0 || point.distanceMeters > profile[index - 1].distanceMeters),
    )
  );
}

function elevationAt(
  profile: Array<{ distanceMeters: number; elevation: number }>,
  distanceMeters: number,
): number | null {
  for (let index = 1; index < profile.length; index += 1) {
    const lower = profile[index - 1];
    const upper = profile[index];
    if (distanceMeters < lower.distanceMeters || distanceMeters > upper.distanceMeters) continue;
    const fraction = (distanceMeters - lower.distanceMeters) / (upper.distanceMeters - lower.distanceMeters);
    return lower.elevation + (upper.elevation - lower.elevation) * fraction;
  }
  return null;
}

/** North American Public Avalanche Danger Scale, which aligns the public five-level scale with likelihood, size, and travel advice. */
export function avalancheDangerScale(): AvalancheDangerScaleEntry[] {
  return [
    {
      level: "low",
      likelihood: "Natural and human-triggered avalanches are unlikely.",
      size: "Small avalanches in isolated terrain are possible.",
      travelAdvice: "Watch for unstable snow on isolated terrain features; identify avalanche terrain before entering.",
    },
    {
      level: "moderate",
      likelihood: "Heightened avalanche conditions on specific terrain features; human triggers are possible.",
      size: "Small avalanches are possible; large avalanches are unlikely.",
      travelAdvice: "Evaluate snow and terrain carefully; identify features of concern and use conservative route choices.",
    },
    {
      level: "considerable",
      likelihood: "Dangerous avalanche conditions; human-triggered avalanches are likely.",
      size: "Small avalanches are likely and large avalanches are possible.",
      travelAdvice: "Careful snowpack evaluation, cautious route-finding, and conservative decision-making are essential.",
    },
    {
      level: "high",
      likelihood: "Very dangerous avalanche conditions; natural avalanches are likely and human triggers are very likely.",
      size: "Large avalanches are likely; very large avalanches are possible.",
      travelAdvice: "Avoid avalanche terrain.",
    },
    {
      level: "extreme",
      likelihood: "Widespread natural avalanches are certain or nearly certain.",
      size: "Large to very large avalanches are expected.",
      travelAdvice: "Avoid all avalanche terrain and runout zones.",
    },
  ];
}

/** Basic trigonometry for terrain inclination; it measures the rise/run supplied, not a field slope measurement. */
export function slopeAngleDegrees(riseM: number, runM: number): number | null {
  if (!Number.isFinite(riseM) || !Number.isFinite(runM) || runM <= 0) return null;
  return roundOne((Math.atan(Math.abs(riseM) / runM) * 180) / Math.PI);
}

/** Avalanche-terrain education: slab avalanches are most common on roughly 30–45° slopes, peaking around 35–40°. */
export function avalancheTerrainRisk(angleDeg: number): AvalancheTerrainRisk | null {
  if (!Number.isFinite(angleDeg) || angleDeg < 0 || angleDeg > 90) return null;
  if (angleDeg < 25) {
    return {
      severity: "info",
      message: "Below 25° rarely slides, but runout zones below steeper slopes still kill. Check what is above and connected to this terrain.",
    };
  }
  if (angleDeg < 30) {
    return {
      severity: "caution",
      message: "About 25–30°: approaching avalanche-starting terrain. Avoid runouts and assess connected steeper slopes.",
    };
  }
  if (angleDeg <= 45) {
    return {
      severity: "warning",
      message: "30–45° is the primary avalanche-starting band, with peak frequency around 35–40°. Use the forecast and choose lower-consequence terrain.",
    };
  }
  if (angleDeg <= 50) {
    return {
      severity: "warning",
      message: "Very steep avalanche terrain. Slabs can still release; exposure and consequences remain high.",
    };
  }
  return {
    severity: "warning",
    message: "Above 50°, loose-snow sluffs are more common than slabs, but they can sweep you into terrain traps or over cliffs.",
  };
}

/**
 * Along-track route-profile screen using a sustained horizontal window. A profile
 * gives only along-track gradient, not cross-slope angle, so it can under-read true avalanche terrain; use it only for screening.
 */
export function slopeAnglesFromProfile(
  profile: Array<{ distanceMeters: number; elevation: number }>,
  windowM = 100,
): { maxAngleDeg: number; atMeters: number } | null {
  if (!validProfile(profile) || !Number.isFinite(windowM) || windowM <= 0) return null;
  const lastDistance = profile[profile.length - 1].distanceMeters;
  let steepest: { maxAngleDeg: number; atMeters: number } | null = null;

  for (const point of profile) {
    const endDistance = point.distanceMeters + windowM;
    if (endDistance > lastDistance) continue;
    const endElevation = elevationAt(profile, endDistance);
    if (endElevation == null) continue;
    const angle = slopeAngleDegrees(endElevation - point.elevation, windowM);
    if (angle == null || (steepest !== null && angle <= steepest.maxAngleDeg)) continue;
    steepest = { maxAngleDeg: angle, atMeters: roundOne(point.distanceMeters + windowM / 2) };
  }
  return steepest;
}

/** ALPTRUTh, Ian McCammon's heuristic for recognizing multiple obvious avalanche risk factors; three or more yes answers is a turn-around rule of thumb. */
export function alptruthChecklist(): AlptruthFactor[] {
  return [
    {
      letter: "A",
      factor: "Avalanche danger posted",
      question: "Is an avalanche danger posted for this area? Rule of thumb: 3 or more yes answers means turn around.",
    },
    { letter: "L", factor: "Loading", question: "Has recent snow, wind loading, or rain added load to the snowpack?" },
    { letter: "P", factor: "Path", question: "Are you in or beneath an obvious avalanche path?" },
    { letter: "T", factor: "Terrain trap", question: "Would a slide carry someone into trees, a gully, creek, cliff, or deep burial?" },
    { letter: "R", factor: "Rating", question: "Is the local danger rating Considerable or higher?" },
    { letter: "U", factor: "Unstable snow signs", question: "Have you seen recent avalanches, shooting cracks, whumpfs, or collapsing snow?" },
    { letter: "T", factor: "Thaw instability", question: "Is rapid warming or thaw making the snow wet and unstable?" },
  ];
}

/** Avalanche burial survival curve summarized in avalanche-rescue education: companion rescue is the only rescue that arrives in time. */
export function companionRescueTimeline(): CompanionRescueTimelineEntry[] {
  return [
    {
      minutes: "0–15 min",
      survival: "About 90% survival when extracted within roughly 10–15 minutes.",
      action: "Companion rescue immediately: search, probe, shovel, airway check.",
    },
    {
      minutes: "15–35 min",
      survival: "Survival collapses steeply toward about 30% by 35 minutes.",
      action: "Keep searching continuously; organized rescue is unlikely to arrive in this window.",
    },
    {
      minutes: ">35 min",
      survival: "Survival is low and depends heavily on an air pocket and injury pattern.",
      action: "Continue rescue, manage airway and trauma after excavation, and call for help when another rescuer can do so.",
    },
  ];
}

/** Standard companion-rescue sequence taught by avalanche education providers and transceiver manufacturers. */
export function beaconSearchPhases(): BeaconSearchPhase[] {
  return [
    { phase: "Signal search", goal: "Acquire the first beacon signal.", technique: "Move quickly through the debris using the planned search strip width and listen/watch for a signal." },
    { phase: "Coarse search", goal: "Rapidly reduce distance to the strongest signal.", technique: "Follow the distance and direction indicators with the beacon low and steady." },
    { phase: "Fine search", goal: "Locate the lowest distance reading.", technique: "Slow down near the victim; keep the beacon at snow surface and use a methodical cross pattern." },
    { phase: "Pinpoint with probe", goal: "Confirm exact location and depth.", technique: "Probe perpendicular to the snow in a systematic pattern; leave the probe in place after a strike." },
    { phase: "Strategic shoveling", goal: "Excavate airway efficiently without collapsing the hole.", technique: "Start downhill of the probe about 1.5 times burial depth; rotate shovelers and clear snow downhill." },
  ];
}

/** Avalanche-rescue education consensus: transceiver, probe, shovel, practiced partners, and a departure partner check are a minimum system. */
export function avalancheGearCheck(): string[] {
  return [
    "Avalanche transceiver/beacon: worn correctly, powered on, fresh batteries.",
    "Probe: assembled and reachable without unpacking everything.",
    "Shovel: metal blade, assembled, and reachable.",
    "All three tools plus practiced partners are required; equipment alone is not rescue readiness.",
    "Before departure, perform a partner check: every beacon transmits and receives, and everyone knows the plan.",
  ];
}

/** Standard companion-rescue priorities: only enter if the scene can be managed safely, then start the rescue rather than leaving the victim alone. */
export function burialActions(): string[] {
  return [
    "Watch the victim continuously; note clothing, direction of travel, and where they disappear.",
    "Mark the last seen point immediately and scan for clues on the surface.",
    "Manage ongoing hazard, then switch your transceiver to search and begin companion rescue.",
    "If you are the only rescuer, do not go for help first: immediate companion rescue is the victim's best chance.",
    "After excavation, clear the airway, assess breathing and trauma, and summon help when possible.",
  ];
}

/** ALPTRUTh (McCammon), the North American Public Avalanche Danger Scale, and conservative terrain screening; this combines entered flags and is not a forecast. */
export function avalancheAssessment(input: {
  danger?: AvalancheDanger;
  alptruthYesCount: number;
  maxSlopeAngleDeg?: number;
  recentSnowCm?: number;
  rapidWarming?: boolean;
}): AvalancheAssessment | null {
  if (
    !input ||
    !Number.isFinite(input.alptruthYesCount) ||
    !Number.isInteger(input.alptruthYesCount) ||
    input.alptruthYesCount < 0 ||
    input.alptruthYesCount > 7 ||
    (input.danger !== undefined && !isAvalancheDanger(input.danger)) ||
    (input.maxSlopeAngleDeg !== undefined &&
      (!Number.isFinite(input.maxSlopeAngleDeg) || input.maxSlopeAngleDeg < 0 || input.maxSlopeAngleDeg > 90)) ||
    (input.recentSnowCm !== undefined && (!Number.isFinite(input.recentSnowCm) || input.recentSnowCm < 0))
  ) {
    return null;
  }

  const reasons: string[] = [];
  const actions: string[] = ["Read the current local avalanche center bulletin before entering avalanche terrain."];
  let noGo = false;
  let severity: Severity = "info";

  if (input.alptruthYesCount >= 3) {
    noGo = true;
    severity = "warning";
    reasons.push(`${input.alptruthYesCount} ALPTRUTh yes answers meet the 3-or-more turn-around rule of thumb.`);
  } else if (input.alptruthYesCount > 0) {
    severity = "caution";
    reasons.push(`${input.alptruthYesCount} ALPTRUTh risk factor${input.alptruthYesCount === 1 ? "" : "s"} entered.`);
  }

  if (input.danger === "extreme" || input.danger === "high") {
    noGo = true;
    severity = "critical";
    reasons.push(`Local danger entered as ${input.danger}: avoid avalanche terrain and runout zones.`);
  } else if (input.danger === "considerable") {
    severity = severity === "info" ? "warning" : severity;
    reasons.push("Local danger entered as considerable: human-triggered avalanches are likely.");
  } else if (input.danger === "moderate") {
    severity = severity === "info" ? "caution" : severity;
    reasons.push("Local danger entered as moderate: evaluate specific terrain features carefully.");
  }

  if (input.maxSlopeAngleDeg !== undefined) {
    const terrain = avalancheTerrainRisk(input.maxSlopeAngleDeg);
    if (terrain && terrain.severity !== "info") {
      severity = severity === "info" ? terrain.severity : severity;
      reasons.push(terrain.message);
    }
  }
  if ((input.recentSnowCm ?? 0) >= 30) {
    severity = severity === "info" ? "warning" : severity;
    reasons.push(`${roundOne(input.recentSnowCm!)} cm of recent snow entered: added loading deserves conservative terrain choices.`);
  }
  if (input.rapidWarming) {
    severity = severity === "info" ? "caution" : severity;
    reasons.push("Rapid warming entered: thaw instability can rise quickly.");
  }

  if (noGo) {
    actions.unshift("Turn around or select low-angle terrain outside avalanche paths and runout zones.");
    actions.push("Do not expose rescuers to a known hazardous slope to prove the assessment.");
    return { severity, snowGoNoGo: "no-go", goNoGo: "no-go", reasons, actions };
  }
  if (reasons.length > 0) {
    actions.unshift("Use conservative route choices and avoid terrain traps; reassess continuously.");
    actions.push("Complete a transceiver partner check and carry a transceiver, probe, and shovel.");
    return { severity, snowGoNoGo: "caution", goNoGo: "caution", reasons, actions };
  }
  return {
    severity: "info",
    snowGoNoGo: "go",
    goNoGo: "caution",
    reasons: ["No risk factors were entered. This is not evidence that conditions are safe."],
    actions: [
      "Obtain the current local forecast and identify avalanche paths and runout zones.",
      "Carry and practice with a transceiver, probe, and shovel; perform a partner check before departure.",
    ],
  };
}
