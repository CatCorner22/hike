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

  // Altitude and ascent rate are *exposure*, not illness. Scoring them into the same
  // total meant a well hiker with zero symptoms at 3500 m after a fast climb was told
  // they had "Moderate altitude illness" — a false alarm that teaches people to ignore
  // the warning bar.
  let exposure = 0;
  if (alt >= 2500) exposure += 1;
  if (alt >= 3000) exposure += 1;
  if (alt >= 3500) exposure += 1;
  if (gain >= 300) exposure += 1;
  if (gain >= 450) exposure += 2;

  let symptomScore = 0;
  for (const s of input.symptoms) {
    symptomScore += SYMPTOM_WEIGHT[s] ?? 0;
  }
  const score = exposure + symptomScore;

  let level: AmsLevel = "none";
  if (input.symptoms.length > 0) {
    if (input.symptoms.includes("ataxia") || score >= 8) level = "severe";
    else if (score >= 5) level = "moderate";
    else level = "mild";
  }

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

/**
 * Simple terrain heuristic — not a substitute for an avalanche forecast or beacon travel.
 *
 * Deliberately takes no aspect. Aspect is the compass direction a slope *faces* — its
 * downhill direction — and the app cannot derive it: the elevation profile is along-track
 * only, which gives gradient but not cross-slope orientation. The navigate panel was
 * passing the user's travel heading instead, which is a different quantity entirely
 * (traverse a slope and your heading is roughly perpendicular to its aspect; climb it and
 * your heading is its opposite). That made "classic avalanche start zone" fire or not
 * fire on identical terrain depending only on which way the hiker happened to be walking.
 *
 * Wind loading and aspect are exactly what the local bulletin is for; `avalanche.ts`
 * carries the ALPTRUTh checklist and danger-scale assessment for inputs a person supplies
 * deliberately.
 */
export function avalancheTerrainWarning(input: {
  slopePct?: number | null;
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

  if (slope >= 35) {
    return `~${slope}% slope with snow possible — classic avalanche start-zone angle. Check the forecast for aspect and wind loading, stay off convex rolls, carry beacon/probe/shovel and travel one at a time.`;
  }

  return `~${slope}% slope in snow season — approaching avalanche start-zone angle. Check the forecast for aspect and wind loading before committing.`;
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
