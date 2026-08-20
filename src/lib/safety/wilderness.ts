/** Civilian backcountry hazards — not tactical. */

export type AmsSymptom =
  | "headache"
  | "nausea"
  | "fatigue"
  | "dizziness"
  | "insomnia"
  | "ataxia";

export type AmsLevel = "none" | "mild" | "moderate" | "severe";

export interface AmsResult {
  score: number;
  level: AmsLevel;
  warning: string | null;
  actions: string[];
}

const SYMPTOM_WEIGHT: Record<AmsSymptom, number> = {
  headache: 2,
  nausea: 2,
  fatigue: 1,
  dizziness: 2,
  insomnia: 1,
  ataxia: 4,
};

export function amsAssessment(input: {
  altitudeM?: number;
  gainLastHourM?: number;
  symptoms: AmsSymptom[];
}): AmsResult {
  const alt = input.altitudeM ?? 0;
  const gain = input.gainLastHourM ?? 0;
  let score = 0;

  if (alt >= 2500) score += 1;
  if (alt >= 3000) score += 1;
  if (alt >= 3500) score += 1;
  if (gain >= 300) score += 1;
  if (gain >= 450) score += 2;

  for (const s of input.symptoms) {
    score += SYMPTOM_WEIGHT[s] ?? 0;
  }

  let level: AmsLevel = "none";
  if (input.symptoms.includes("ataxia") || score >= 8) level = "severe";
  else if (score >= 5) level = "moderate";
  else if (score >= 2 || input.symptoms.length > 0) level = "mild";

  const actions: string[] = [];
  let warning: string | null = null;

  if (level === "severe") {
    warning =
      "Possible HACE/HAPE — stop ascent, give O₂ if available, descend immediately. This is an emergency.";
    actions.push("Descend at least 300–500 m if you can do so safely.");
    actions.push("Do not sleep at this altitude if confused or short of breath at rest.");
  } else if (level === "moderate") {
    warning = "Moderate altitude illness — do not go higher. Rest, hydrate, monitor closely.";
    actions.push("Descend if symptoms worsen or do not improve in 1 hour at rest.");
    actions.push("Avoid alcohol and sedatives. Buddy-check every 15 min.");
  } else if (level === "mild") {
    warning = "Mild AMS signs — slow down, hydrate, and do not climb higher today.";
    actions.push("Rest at the same elevation. Acetaminophen for headache if you normally tolerate it.");
  } else if (alt >= 2800 && gain >= 400) {
    warning = `High and fast (+${Math.round(gain)} m/hr) — watch for headache, nausea, or unsteady gait.`;
    actions.push("Consider a rest day before pushing higher.");
  }

  return { score, level, warning, actions };
}

/** Simple terrain heuristic — not a substitute for avalanche forecast or beacon travel. */
export function avalancheTerrainWarning(input: {
  slopePct?: number | null;
  aspectDeg?: number;
  month?: number;
  snowOnGround?: boolean;
}): string | null {
  const slope = input.slopePct;
  if (slope == null || slope < 25) return null;

  const month = input.month ?? new Date().getMonth() + 1;
  const winter = month >= 11 || month <= 4;
  const snow = input.snowOnGround ?? winter;

  if (slope >= 45) {
    return `Slope ~${slope}% — avalanche terrain and fall hazard. Avoid if snow is present; travel one at a time.`;
  }

  if (!snow || slope < 30) return null;

  const aspect = input.aspectDeg;
  const leeward =
    aspect != null &&
    ((aspect >= 135 && aspect <= 225) || (aspect >= 315 || aspect <= 45));

  if (slope >= 30 && leeward) {
    return `~${slope}% leeward slope in snow season — classic avalanche start zone. Check forecast, carry beacon/probe/shovel, one at a time.`;
  }

  if (slope >= 35) {
    return `~${slope}% slope with snow possible — stay off convex rolls and wind-loaded pockets.`;
  }

  return null;
}

export function bearSafetyCard(): string[] {
  return [
    "Store food and scented items in a bear can or hang — never in the tent.",
    "Cook and eat 60+ m from where you sleep. Pack out all trash.",
    "Make noise in brush; avoid surprising animals at close range.",
    "If you see a bear at distance, give it space and detour — do not approach for photos.",
    "In grizzly country carry bear spray on your belt, not in your pack.",
    "Never run from a bear. Group up, speak calmly, back away slowly.",
    "If attacked by a black bear — fight back. Grizzly brown bear — play dead unless predatory.",
  ];
}

export type WildlifeAnimal = "bear_black" | "bear_grizzly" | "moose" | "cougar";

export function wildlifeEncounterSop(animal: WildlifeAnimal): string[] {
  switch (animal) {
    case "bear_black":
      return [
        "Stop. Do not run. Make yourself look large.",
        "Back away slowly while facing the bear. Leave an escape route.",
        "If it charges or attacks — fight back with rocks, sticks, spray.",
      ];
    case "bear_grizzly":
      return [
        "Stop. Speak calmly. Back away slowly — never run.",
        "If a mother with cubs — increase distance; she is defending, not hunting.",
        "If contact is made — play dead face-down, hands on neck, legs spread.",
        "If attack continues or is predatory — fight back hard.",
      ];
    case "moose":
      return [
        "Give a wide berth — moose kick and charge more than bears.",
        "If ears are back and hair raised, you are too close. Back away behind a tree.",
        "If charged, run to cover (tree, rock). Do not stand your ground.",
      ];
    case "cougar":
      return [
        "Do not run. Maintain eye contact. Appear large.",
        "Back away slowly. If children present, pick them up without bending.",
        "If it approaches — yell, throw rocks, fight if attacked.",
      ];
  }
}

export function snakeBiteSop(): string[] {
  return [
    "Move away from the snake. Note color/band pattern if safe — do not capture it.",
    "Keep the bitten limb still and at or below heart level.",
    "Remove rings/watches before swelling. Loosen clothing, not a tourniquet.",
    "Do NOT cut, suck, ice, or use a commercial extractor.",
    "Mark swelling edge with time. Record symptoms.",
    "Evacuate — antivenom is hospital-only. Call 911 / SAR with your grid.",
  ];
}

export function wildernessFirstAidCard(): string[] {
  return [
    "M — Massive bleed: direct pressure, tourniquet if spurting won't stop.",
    "A — Airway: head-tilt/chin-lift if unconscious and breathing.",
    "R — Respiration: rescue breaths if not breathing after 5 compressions (if trained).",
    "C — Circulation: CPR if no pulse (100–120/min chest compressions).",
    "H — Hypothermia: get dry, insulate from ground, warm core — not hot bath if severe.",
    "Sprains: RICE — rest, ice (10 min), compression wrap, elevate.",
    "Allergic reaction: epinephrine auto-injector if prescribed; antihistamine secondary.",
  ];
}

export function foodStorageReminder(isCamping = false): string | null {
  if (!isCamping) return null;
  return "Camp mode — bear-can or proper hang required. No food in tent.";
}
