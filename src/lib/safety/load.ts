import { workRestCycle } from "@/lib/safety/thermal";
import type { Severity } from "@/lib/safety/severity";
import { formatReport, reportField } from "@/lib/safety/report-field";

export type TerrainFactor =
  | "paved"
  | "dirt-road"
  | "light-brush"
  | "heavy-brush"
  | "swampy-bog"
  | "loose-sand"
  | "snow-15cm"
  | "snow-25cm"
  | "snow-35cm";

export const TERRAIN_FACTORS: Record<TerrainFactor, number> = {
  paved: 1,
  "dirt-road": 1.1,
  "light-brush": 1.2,
  "heavy-brush": 1.5,
  "swampy-bog": 1.8,
  "loose-sand": 2.1,
  "snow-15cm": 2.5,
  "snow-25cm": 3.3,
  "snow-35cm": 4.1,
};

export interface WaterRequirement {
  liters: number;
  waterKg: number;
  litersPerHour: number;
  note: string;
}

export interface PackWeightAdvice {
  percentBodyweight: number;
  severity: Severity;
  message: string;
}

export interface CalorieRequirement {
  kcal: number;
  foodKg: number;
}

export interface RuckMarchPace {
  minutes: number;
  kph: number;
  note: string;
}

export interface LoadPlanInput {
  bodyMassKg: number;
  baseWeightKg: number;
  hours: number;
  distanceM: number;
  speedMs: number;
  gradePct: number;
  terrain: TerrainFactor;
  workRate: "easy" | "moderate" | "hard";
  wbgtC?: number;
}

export interface LoadPlan {
  baseWeightKg: number;
  water: WaterRequirement;
  calories: CalorieRequirement;
  totalPackKg: number;
  packAdvice: PackWeightAdvice;
  march: RuckMarchPace;
}

export const DISCLAIMER =
  "Planning estimates, not a fitness clearance or ration prescription. Adjust for the person, weather, route, medical needs, and observed fatigue; turn back before safety margins disappear.";

const FOOD_ENERGY_DENSITY_KCAL_PER_KG = 4250;
const MAX_WATER_L_PER_HOUR = 1.5;
const MAX_WATER_L_PER_DAY = 12;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function validMass(value: number, max: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= max;
}

function basePandolfWatts(input: {
  bodyMassKg: number;
  loadKg: number;
  speedMs: number;
  gradePct: number;
  terrain: TerrainFactor;
}): number {
  const { bodyMassKg: w, loadKg: l, speedMs: v, gradePct: g, terrain } = input;
  const terrainFactor = TERRAIN_FACTORS[terrain];
  return 1.5 * w + 2 * (w + l) * Math.pow(l / w, 2) + terrainFactor * (w + l) * (1.5 * v * v + 0.35 * v * g);
}

/**
 * Pandolf, Givoni & Goldman (1977) load-carriage equation. For negative grades, this applies the empirical
 * Santee et al. (2001) downhill correction; it is less certain outside the study conditions, so treat it as an estimate.
 */
export function pandolfWatts(input: {
  bodyMassKg: number;
  loadKg: number;
  speedMs: number;
  gradePct: number;
  terrain: TerrainFactor;
}): number | null {
  const { bodyMassKg: w, loadKg: l, speedMs: v, gradePct: g, terrain } = input;
  if (
    !validMass(w, 300) ||
    w === 0 ||
    !validMass(l, 150) ||
    !Number.isFinite(v) ||
    !Number.isFinite(g) ||
    v <= 0 ||
    v > 2.5 ||
    g < -35 ||
    g > 35 ||
    typeof terrain !== "string" ||
    !Object.hasOwn(TERRAIN_FACTORS, terrain)
  ) {
    return null;
  }
  const raw = basePandolfWatts(input);
  if (g >= 0) return round1(raw);

  // Santee et al. correction is applied only to negative grade. It replaces raw Pandolf's invalid descent behavior.
  const correction =
    TERRAIN_FACTORS[terrain] *
    ((g * (w + l) * v) / 3.5 - ((w + l) * Math.pow(g + 6, 2)) / w + (25 - v * v));
  return round1(raw - correction);
}

/** Pandolf, Givoni & Goldman (1977); converts estimated metabolic watts using 1 kcal = 4184 J. */
export function pandolfKcalPerHour(input: {
  bodyMassKg: number;
  loadKg: number;
  speedMs: number;
  gradePct: number;
  terrain: TerrainFactor;
}): number | null {
  const watts = pandolfWatts(input);
  return watts == null ? null : round1((watts * 3600) / 4184);
}

/** Backpacking convention, not doctrine: under ~20% body weight is a common target; ~30% is hard and higher military loads carry rising injury risk. */
export function packWeightAdvice(input: { bodyMassKg: number; packKg: number }): PackWeightAdvice | null {
  const { bodyMassKg, packKg } = input;
  if (!validMass(bodyMassKg, 300) || bodyMassKg === 0 || !validMass(packKg, 150)) return null;
  const percentBodyweight = round1((packKg / bodyMassKg) * 100);
  if (percentBodyweight < 20) {
    return { percentBodyweight, severity: "info", message: "Under the common ~20% backpacking target. It is still a guideline: terrain, fitness, and injury history matter." };
  }
  if (percentBodyweight < 30) {
    return { percentBodyweight, severity: "caution", message: "Above the common ~20% backpacking target. Reduce nonessential weight and monitor feet, knees, pace, and balance." };
  }
  return { percentBodyweight, severity: "warning", message: "About 30% or more of body weight is a hard carry. Military approach marches can run higher, but injury rates rise with load; cut weight or distance." };
}

/** TB MED 507 fluid guidance with its 1.5 L/hour and 12 L/day anti-hyponatremia caps; water weighs 1 kg per L. */
export function waterRequirementLiters(input: {
  hours: number;
  wbgtC?: number;
  workRate: "easy" | "moderate" | "hard";
}): WaterRequirement | null {
  const { hours, wbgtC, workRate } = input;
  if (
    !Number.isFinite(hours) ||
    hours <= 0 ||
    hours > 24 ||
    (wbgtC != null && !Number.isFinite(wbgtC)) ||
    !["easy", "moderate", "hard"].includes(workRate)
  ) {
    return null;
  }
  const defaultRates: Record<typeof workRate, number> = { easy: 0.5, moderate: 0.7, hard: 1 };
  const heatPlan = wbgtC == null ? null : workRestCycle(wbgtC, workRate);
  if (wbgtC != null && heatPlan == null) return null;
  const litersPerHour = Math.min(heatPlan?.waterLitersPerHour ?? defaultRates[workRate], MAX_WATER_L_PER_HOUR);
  const liters = Math.min(litersPerHour * hours, MAX_WATER_L_PER_DAY);
  return {
    liters: round1(liters),
    waterKg: round1(liters),
    litersPerHour: round1(litersPerHour),
    note: "Water is 1 kg/L. Do not exceed about 1.5 L/hour or 12 L/day: overdrinking can cause fatal hyponatremia.",
  };
}

/** Pandolf, Givoni & Goldman (1977), using 4,250 kcal/kg as a realistic well-chosen backcountry-food energy-density assumption (typical range ~4,000–4,500). */
export function calorieRequirement(input: {
  bodyMassKg: number;
  loadKg: number;
  hours: number;
  speedMs: number;
  gradePct: number;
  terrain: TerrainFactor;
}): CalorieRequirement | null {
  const { hours, ...pandolfInput } = input;
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) return null;
  const kcalPerHour = pandolfKcalPerHour(pandolfInput);
  if (kcalPerHour == null) return null;
  const kcal = round1(kcalPerHour * hours);
  return { kcal, foodKg: round1(kcal / FOOD_ENERGY_DENSITY_KCAL_PER_KG) };
}

/** U.S. military movement-planning rule of thumb: plan roughly 4 km/h on foot with load, then slow for heavier loads and grades. */
export function ruckMarchPace(input: { distanceM: number; loadKg: number; gradePct?: number }): RuckMarchPace | null {
  const { distanceM, loadKg, gradePct = 0 } = input;
  if (!Number.isFinite(distanceM) || !validMass(loadKg, 150) || !Number.isFinite(gradePct) || distanceM <= 0 || distanceM > 100_000 || gradePct < -35 || gradePct > 35) return null;
  const kph = Math.max(1.5, 4 - Math.max(0, loadKg - 20) * 0.025 - Math.max(0, gradePct) * 0.05 - Math.max(0, -gradePct - 5) * 0.02);
  return {
    minutes: round1(((distanceM / 1000) / kph) * 60),
    kph: round1(kph),
    note: "Planning estimate only: 4 km/h is a common loaded-foot-movement figure. Terrain, altitude, stops, heat, and fatigue can slow it sharply.",
  };
}

/** The Mountaineers' Ten Essentials systems, adapted as a concise field checklist. */
export function tenEssentials(): Array<{ item: string; why: string }> {
  return [
    { item: "Navigation", why: "Map, compass, and GPS/phone backup keep a small error from becoming an overnight." },
    { item: "Headlamp", why: "Light plus spare power prevents a late finish from becoming a navigation or fall emergency." },
    { item: "Sun protection", why: "Sunscreen, sunglasses, and clothing reduce burns, snow blindness, and heat load." },
    { item: "First aid", why: "Carry supplies and the skill to manage bleeding, blisters, sprains, and common trail problems." },
    { item: "Knife and repair kit", why: "A knife, tape, and repair items keep critical clothing and shelter systems working." },
    { item: "Fire", why: "Reliable ignition and tinder can provide emergency warmth and signaling where legal and safe." },
    { item: "Shelter", why: "An emergency shelter blocks wind and precipitation when movement stops unexpectedly." },
    { item: "Extra food", why: "Reserve calories protect decision-making and warmth when the route takes longer than planned." },
    { item: "Extra water", why: "Carry enough capacity and treatment to bridge a missed or contaminated source." },
    { item: "Extra clothes", why: "Dry insulation and a shell protect against the cold, wet, and wind that arrive after a stop." },
  ];
}

/** Composes Pandolf energy, TB MED 507 water planning, pack-load guidance, and a 4 km/h ruck-march estimate. Food burn is calculated from base weight to avoid pretending this solves the food-weight feedback loop. */
export function loadPlan(input: LoadPlanInput): LoadPlan | null {
  const { bodyMassKg, baseWeightKg, hours, distanceM, speedMs, gradePct, terrain, workRate, wbgtC } = input;
  if (!validMass(baseWeightKg, 150)) return null;
  const water = waterRequirementLiters({ hours, wbgtC, workRate });
  const calories = calorieRequirement({ bodyMassKg, loadKg: baseWeightKg, hours, speedMs, gradePct, terrain });
  if (water == null || calories == null) return null;
  const totalPackKg = round1(baseWeightKg + water.waterKg + calories.foodKg);
  const packAdvice = packWeightAdvice({ bodyMassKg, packKg: totalPackKg });
  const march = ruckMarchPace({ distanceM, loadKg: totalPackKg, gradePct });
  if (packAdvice == null || march == null) return null;
  return { baseWeightKg, water, calories, totalPackKg, packAdvice, march };
}

/** Field-report style inspired by the existing 9-line MEDEVAC formatter. */
export function formatLoadPlan(plan: LoadPlan): string {
  const fixed = (value: number, digits: number) => (Number.isFinite(value) ? value.toFixed(digits) : "UNKNOWN");
  return formatReport([
    "LOAD PLAN",
    `BASE WEIGHT: ${fixed(plan.baseWeightKg, 1)} kg`,
    `WATER: ${fixed(plan.water.liters, 1)} L / ${fixed(plan.water.waterKg, 1)} kg (${fixed(plan.water.litersPerHour, 1)} L/hr)`,
    `FOOD: ${fixed(plan.calories.kcal, 0)} kcal / ${fixed(plan.calories.foodKg, 1)} kg (assumes ${FOOD_ENERGY_DENSITY_KCAL_PER_KG} kcal/kg)`,
    `TOTAL PACK: ${fixed(plan.totalPackKg, 1)} kg`,
    `PACK LOAD: ${fixed(plan.packAdvice.percentBodyweight, 1)}% BW — ${reportField(plan.packAdvice.message)}`,
    `MARCH: ${fixed(plan.march.minutes, 0)} min at ${fixed(plan.march.kph, 1)} km/h`,
    "HYDRATION CAP: Never exceed about 1.5 L/hr or 12 L/day; overdrinking can cause fatal hyponatremia.",
  ]);
}
