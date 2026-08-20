import { windChillC } from "@/lib/safety/field-ops";
import type { Severity } from "@/lib/safety/severity";

export type HeatCategory = 1 | 2 | 3 | 4 | 5;
export type WorkRate = "easy" | "moderate" | "hard";
export type HeatFlag = "white" | "green" | "yellow" | "red" | "black";

export interface HeatCategoryResult {
  category: HeatCategory;
  flag: HeatFlag;
  wbgtRangeC: string;
}

export interface WorkRestCycle {
  category: HeatCategory;
  workMinutes: number | "continuous";
  restMinutes: number;
  waterLitersPerHour: number;
  note: string;
}

export interface HypothermiaAssessment {
  stage: "mild" | "moderate" | "severe" | "none";
  severity: Severity;
  actions: string[];
}

export interface HeatIllnessAssessment {
  condition: "cramps" | "exhaustion" | "stroke" | "none";
  severity: Severity;
  actions: string[];
}

export const DISCLAIMER =
  "Training aid, not medical direction. Heat stroke and serious hypothermia are emergencies: cool or insulate promptly, evacuate, and get professional care.";

const HEAT_CATEGORY_NOTE =
  "Hyponatremia cap: do not exceed about 1.5 L/hour or 12 L/day. Overdrinking can cause fatal hyponatremia; drink to the plan, eat normally, and seek medical help for confusion, vomiting, or worsening symptoms.";

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function validWbgt(wbgtC: number): boolean {
  return Number.isFinite(wbgtC) && wbgtC >= -20 && wbgtC <= 60;
}

/** TB MED 507 heat categories and flag colors; values below the table begin at white/category 1. */
export function heatCategory(wbgtC: number): HeatCategoryResult | null {
  if (!validWbgt(wbgtC)) return null;
  if (wbgtC < 25.6) return { category: 1, flag: "white", wbgtRangeC: "<25.6°C (<78°F)" };
  if (wbgtC < 27.8) return { category: 1, flag: "white", wbgtRangeC: "25.6–27.7°C (78–81.9°F)" };
  if (wbgtC < 29.4) return { category: 2, flag: "green", wbgtRangeC: "27.8–29.3°C (82–84.9°F)" };
  if (wbgtC < 31.1) return { category: 3, flag: "yellow", wbgtRangeC: "29.4–31.0°C (85–87.9°F)" };
  if (wbgtC < 32.2) return { category: 4, flag: "red", wbgtRangeC: "31.1–32.1°C (88–89.9°F)" };
  return { category: 5, flag: "black", wbgtRangeC: ">=32.2°C (>=90°F)" };
}

/** TB MED 507 work/rest and fluid table for heat-acclimatized personnel in normal hot-weather clothing. */
export function workRestCycle(wbgtC: number, workRate: WorkRate): WorkRestCycle | null {
  const category = heatCategory(wbgtC);
  if (category == null || !["easy", "moderate", "hard"].includes(workRate)) return null;

  const table: Record<HeatCategory, Record<WorkRate, Omit<WorkRestCycle, "category" | "note">>> = {
    1: {
      easy: { workMinutes: "continuous", restMinutes: 0, waterLitersPerHour: 0.5 },
      moderate: { workMinutes: "continuous", restMinutes: 0, waterLitersPerHour: 0.7 },
      hard: { workMinutes: 40, restMinutes: 20, waterLitersPerHour: 0.7 },
    },
    2: {
      easy: { workMinutes: "continuous", restMinutes: 0, waterLitersPerHour: 0.5 },
      moderate: { workMinutes: 50, restMinutes: 10, waterLitersPerHour: 0.7 },
      hard: { workMinutes: 30, restMinutes: 30, waterLitersPerHour: 1 },
    },
    3: {
      easy: { workMinutes: "continuous", restMinutes: 0, waterLitersPerHour: 0.7 },
      moderate: { workMinutes: 40, restMinutes: 20, waterLitersPerHour: 0.7 },
      hard: { workMinutes: 30, restMinutes: 30, waterLitersPerHour: 1 },
    },
    4: {
      easy: { workMinutes: "continuous", restMinutes: 0, waterLitersPerHour: 0.7 },
      moderate: { workMinutes: 30, restMinutes: 30, waterLitersPerHour: 0.7 },
      hard: { workMinutes: 20, restMinutes: 40, waterLitersPerHour: 1 },
    },
    5: {
      easy: { workMinutes: 50, restMinutes: 10, waterLitersPerHour: 1 },
      moderate: { workMinutes: 20, restMinutes: 40, waterLitersPerHour: 1 },
      hard: { workMinutes: 10, restMinutes: 50, waterLitersPerHour: 1 },
    },
  };
  return { category: category.category, ...table[category.category][workRate], note: HEAT_CATEGORY_NOTE };
}

/**
 * Stull (2011) wet-bulb approximation plus ISO 7243 WBGT component weighting. A real WBGT requires
 * natural wet-bulb and black-globe thermometers; this air-temperature/RH estimate is planning-only.
 */
export function estimateWbgtC(input: { tempC: number; rhPct: number; inSun: boolean }): number | null {
  const { tempC, rhPct, inSun } = input;
  if (!Number.isFinite(tempC) || !Number.isFinite(rhPct) || typeof inSun !== "boolean") return null;
  if (tempC < -20 || tempC > 50 || rhPct < 5 || rhPct > 99) return null;
  const wetBulbC =
    tempC * Math.atan(0.151977 * Math.sqrt(rhPct + 8.313659)) +
    Math.atan(tempC + rhPct) -
    Math.atan(rhPct - 1.676331) +
    0.00391838 * Math.pow(rhPct, 1.5) * Math.atan(0.023101 * rhPct) -
    4.686035;
  const globeC = tempC + (inSun ? 5 : 0);
  return round1(0.7 * wetBulbC + (inSun ? 0.2 * tempC + 0.1 * globeC : 0.3 * tempC));
}

/** Environment and Climate Change Canada wind-chill frostbite bands; exposed-skin estimate only. */
export function frostbiteMinutes(tempC: number, windKph: number): number | null {
  if (!Number.isFinite(tempC) || !Number.isFinite(windKph)) return null;
  if (tempC < -80 || tempC > 10 || windKph < 0 || windKph > 250) return null;
  const chillC = windKph >= 5 ? windChillC(tempC, windKph) : tempC;
  if (chillC == null || chillC > -28) return null;
  if (chillC <= -55) return 2;
  if (chillC <= -48) return 5;
  if (chillC <= -40) return 10;
  return 30;
}

/** Environment and Climate Change Canada wind-chill frostbite bands; a warning is returned only at timed risk. */
export function frostbiteWarning(tempC: number, windKph: number): string | null {
  const minutes = frostbiteMinutes(tempC, windKph);
  if (minutes == null) return null;
  return `Exposed skin may freeze in about ${minutes} minutes or less. Cover all skin, get out of the wind, and check for numbness or white patches.`;
}

/** Swiss hypothermia staging (ICAR MedCom): clinical signs guide staging when a reliable core temperature is unavailable. */
export function hypothermiaStage(input: {
  coreTempC?: number;
  shivering: boolean;
  alteredMental: boolean;
  conscious: boolean;
}): HypothermiaAssessment | null {
  const { coreTempC, shivering, alteredMental, conscious } = input;
  if (
    (coreTempC != null && (!Number.isFinite(coreTempC) || coreTempC < 20 || coreTempC > 45)) ||
    typeof shivering !== "boolean" ||
    typeof alteredMental !== "boolean" ||
    typeof conscious !== "boolean"
  ) {
    return null;
  }
  const severe = !conscious || (coreTempC != null && coreTempC < 28);
  const moderate = !severe && (alteredMental || !shivering || (coreTempC != null && coreTempC < 32));
  const mild = !severe && !moderate && (shivering || (coreTempC != null && coreTempC < 35));
  if (severe) {
    return {
      stage: "severe",
      severity: "critical",
      actions: [
        "Call emergency services and evacuate urgently; protect airway and insulate from ground, wind, and moisture.",
        "Handle gently and keep horizontal: rough handling of a severely hypothermic casualty can trigger a fatal arrhythmia.",
        "Do not declare death in the field: no one is dead until warm and dead. Start CPR only if no signs of life and trained to do so.",
      ],
    };
  }
  if (moderate) {
    return {
      stage: "moderate",
      severity: "warning",
      actions: [
        "Stop heat loss now: shelter, dry insulation, vapor/wind barrier, and gentle evacuation.",
        "Shivering may stop in moderate hypothermia; do not rely on feeling warmer as reassurance.",
        "Give warm, sweet drinks only if fully conscious and able to swallow; avoid alcohol and exertion.",
      ],
    };
  }
  if (mild) {
    return {
      stage: "mild",
      severity: "caution",
      actions: [
        "Stop, add dry layers, block wind, insulate from the ground, and replace calories and warm fluids if able to swallow.",
        "Do not press on into worsening cold, wetness, fatigue, or shivering; reassess often and turn back or shelter.",
      ],
    };
  }
  return { stage: "none", severity: "info", actions: ["No hypothermia signs supplied; stay dry, fed, and protected from wind."] };
}

/** Wilderness Medical Society cold-exposure prevention principles; cotton and wet insulation markedly accelerate heat loss. */
export function layeringAdvice(tempC: number, windKph: number, isWet: boolean): string[] | null {
  if (!Number.isFinite(tempC) || !Number.isFinite(windKph) || typeof isWet !== "boolean") return null;
  if (tempC < -80 || tempC > 50 || windKph < 0 || windKph > 250) return null;
  const advice = [
    "Use a wicking base layer, insulating mid-layer, and wind/rain shell; vent before you soak your layers with sweat.",
    "Avoid cotton: cotton kills because it holds water and loses insulation. Use wool or synthetic layers instead.",
    "Keep a dry insulation layer and dry socks sealed in the pack; wet insulation loses most of its value.",
  ];
  if (windKph >= 20) advice.push("Add a windproof shell, hat, gloves or mittens, and neck/face cover before exposed skin cools.");
  if (isWet) advice.push("Get out of wet clothing now if practical; shelter, dry, and insulate from the ground before moving on.");
  if (tempC <= 5) advice.push("Carry active insulation for every stop; slow movement and darkness can turn cool weather into a hypothermia problem.");
  return advice;
}

/** Wilderness Medical Society heat-illness guidance: altered mental status in a hot person is heat stroke until proven otherwise. */
export function heatIllnessTriage(input: {
  coreTempC?: number;
  alteredMental: boolean;
  sweating: boolean;
  crampsOnly: boolean;
}): HeatIllnessAssessment | null {
  const { coreTempC, alteredMental, sweating, crampsOnly } = input;
  if (
    (coreTempC != null && (!Number.isFinite(coreTempC) || coreTempC < 30 || coreTempC > 45)) ||
    typeof alteredMental !== "boolean" ||
    typeof sweating !== "boolean" ||
    typeof crampsOnly !== "boolean"
  ) {
    return null;
  }
  if (alteredMental) {
    return {
      condition: "stroke",
      severity: "critical",
      actions: [
        "HEAT STROKE: altered mental status during heat exposure is an emergency. Call emergency services and evacuate.",
        "Cool immediately with cold-water immersion when available; otherwise use continuous cold-water dousing, ice towels, and vigorous fanning. Do not delay cooling for transport.",
        "Protect airway; do not force fluids by mouth if confused, vomiting, or unable to swallow.",
      ],
    };
  }
  if (crampsOnly) {
    return {
      condition: "cramps",
      severity: "caution",
      actions: [
        "Stop activity, rest in shade, and gently stretch the affected muscles.",
        "Drink to thirst with food or an electrolyte drink; do not overdrink plain water.",
      ],
    };
  }
  if (sweating || (coreTempC != null && coreTempC >= 38)) {
    return {
      condition: "exhaustion",
      severity: "warning",
      actions: [
        "Stop activity, move to shade or a cool place, loosen clothing, and actively cool with water and airflow.",
        "Sip fluids only if alert and able to swallow. If symptoms worsen, do not improve promptly, or mental status changes, treat as heat stroke and evacuate.",
      ],
    };
  }
  return {
    condition: "none",
    severity: "info",
    actions: ["No heat-illness pattern supplied; use heat controls early and reassess if symptoms develop."],
  };
}
