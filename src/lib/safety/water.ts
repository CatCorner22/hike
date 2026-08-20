import type { Severity } from "@/lib/safety/severity";

export const DISCLAIMER =
  "Training aid, not medical direction. Treat uncertain water, avoid contaminated sources, and seek urgent care for heat illness, severe dehydration, or confusion.";

export type ChemicalMethod = "chlorine-dioxide" | "iodine" | "bleach";
export type WorkRate = "easy" | "moderate" | "hard";
export type WaterSource = "spring" | "flowing-stream" | "standing-water" | "snowmelt" | "lake" | "tank";

export interface PurificationMethod {
  method: string;
  killsBacteria: boolean;
  killsProtozoa: boolean;
  killsViruses: boolean;
  removesSediment: boolean;
  timeMinutes: string;
  notes: string;
}

export interface SourceRisk {
  severity: Severity;
  message: string;
  treatBefore: boolean;
}

export interface HydrationPlan {
  liters: number;
  kg: number;
  note: string;
}

/** CDC drinking-water guidance: bring water to a rolling boil for 1 minute; at elevations above about 2,000 m (6,500 ft), boil for 3 minutes. WHO also recognizes boiling as effective disinfection. */
export function boilTimeMinutes(elevationM: number): number | null {
  if (!Number.isFinite(elevationM)) return null;
  return elevationM >= 2000 ? 3 : 1;
}

/** CDC and WHO household water-treatment guidance. “Kills” includes effective physical removal where that is how a filter works; no listed method makes cyanotoxin-contaminated water safe. */
export function purificationMethods(): PurificationMethod[] {
  return [
    {
      method: "Boiling",
      killsBacteria: true,
      killsProtozoa: true,
      killsViruses: true,
      removesSediment: false,
      timeMinutes: "1; 3 above ~2,000 m, plus cooling",
      notes: "Rolling boil disinfects microbes but does not remove dirt, chemicals, heavy metals, or cyanotoxins.",
    },
    {
      method: "0.1–0.2 micron hollow-fibre filter",
      killsBacteria: true,
      killsProtozoa: true,
      killsViruses: false,
      removesSediment: true,
      timeMinutes: "Immediate while filtering",
      notes: "Standard backpacking filters remove bacteria and protozoa, but do not reliably remove viruses. Protect the filter from freezing.",
    },
    {
      method: "UV purifier",
      killsBacteria: true,
      killsProtozoa: true,
      killsViruses: true,
      removesSediment: false,
      timeMinutes: "Usually 1–2",
      notes: "Works only in clear water with charged equipment; pre-filter cloudy water and follow the device dose instructions.",
    },
    {
      method: "Chlorine dioxide",
      killsBacteria: true,
      killsProtozoa: true,
      killsViruses: true,
      removesSediment: false,
      timeMinutes: "30; up to 240 for Cryptosporidium",
      notes: "Effective against Cryptosporidium only with a long contact time. Cold or cloudy water needs more time.",
    },
    {
      method: "Iodine",
      killsBacteria: true,
      killsProtozoa: false,
      killsViruses: true,
      removesSediment: false,
      timeMinutes: "30 or longer when cold/cloudy",
      notes: "Poor against Cryptosporidium. Follow product limits; iodine is not appropriate for everyone, including many pregnant people.",
    },
    {
      method: "Unscented chlorine bleach",
      killsBacteria: true,
      killsProtozoa: false,
      killsViruses: true,
      removesSediment: false,
      timeMinutes: "30 or longer when cold/cloudy",
      notes: "Use only plain, unscented household bleach at a verified dose. Poor against Cryptosporidium; never mix chemicals.",
    },
  ];
}

/** CDC emergency disinfection principles: label dose governs; colder or cloudy water requires substantially longer contact. Chlorine dioxide needs up to 4 hours for Cryptosporidium. */
export function chemicalDoseWaitMinutes(input: {
  method: ChemicalMethod;
  waterTempC: number;
  cloudy: boolean;
}): number | null {
  // Meltwater sits at or just below 0 C, which is precisely when the extended contact
  // time matters most; rejecting it left the coldest water with no guidance at all.
  if (!Number.isFinite(input.waterTempC) || input.waterTempC < -5 || input.waterTempC > 50) return null;
  const base = input.method === "chlorine-dioxide" ? 240 : 30;
  const coldMultiplier = input.waterTempC < 10 ? 1.5 : 1;
  const cloudyMultiplier = input.cloudy ? 1.5 : 1;
  return Math.round(base * coldMultiplier * cloudyMultiplier);
}

/** CDC harmful-algal-bloom and drinking-water guidance: visible algae/cyanobacteria is a hard stop because filters and boiling do not reliably remove cyanotoxins. */
export function sourceRisk(input: {
  source: WaterSource;
  upstreamGrazing: boolean;
  upstreamCamping: boolean;
  algaeVisible: boolean;
}): SourceRisk {
  if (input.algaeVisible) {
    return {
      severity: "critical",
      treatBefore: true,
      message:
        "HARD STOP: visible algae or cyanobacteria can contain cyanotoxins. Do not drink it — filtering or boiling does not reliably remove cyanotoxins; find another source.",
    };
  }

  const upstreamContamination = input.upstreamGrazing || input.upstreamCamping;
  if (input.source === "standing-water" || input.source === "lake") {
    return {
      severity: upstreamContamination ? "warning" : "caution",
      treatBefore: true,
      message: `Still water can hold pathogens and sediment${upstreamContamination ? "; upstream people or livestock add contamination risk" : ""}. Collect the clearest water available and treat it before drinking.`,
    };
  }
  if (input.source === "tank") {
    return {
      severity: "warning",
      treatBefore: true,
      message: "Tank water has an unknown treatment and maintenance history. Treat it before drinking unless a responsible operator confirms it is potable.",
    };
  }
  if (input.source === "snowmelt") {
    return {
      severity: upstreamContamination ? "warning" : "caution",
      treatBefore: true,
      message: "Melted snow is not automatically sterile. Melt it, collect from clean snow, and treat it before drinking.",
    };
  }
  if (input.source === "spring") {
    return {
      severity: upstreamContamination ? "warning" : "caution",
      treatBefore: true,
      message: `A spring can be cleaner than surface water, but its source and plumbing are usually unknown${upstreamContamination ? " and upstream contamination is present" : ""}. Treat before drinking.`,
    };
  }
  return {
    severity: upstreamContamination ? "warning" : "caution",
    treatBefore: true,
    message: `Flowing water is not automatically safe${upstreamContamination ? "; upstream people or livestock raise pathogen risk" : ""}. Take clear water upstream of camps where possible and treat before drinking.`,
  };
}

/** Wilderness Medical Society heat-illness guidance and field practice: sweat loss varies widely; this conservative planning estimate is capped at 1.5 L/h to avoid promoting overdrinking. */
export function sweatRateLitersPerHour(input: {
  tempC: number;
  workRate: WorkRate;
  acclimatized: boolean;
}): number | null {
  if (!Number.isFinite(input.tempC) || input.tempC < -40 || input.tempC > 60) return null;
  if (input.workRate !== "easy" && input.workRate !== "moderate" && input.workRate !== "hard") return null;
  const baseline = input.workRate === "easy" ? 0.3 : input.workRate === "moderate" ? 0.5 : 0.7;
  const heatLoad = Math.max(0, input.tempC - 10) * 0.03;
  const lackOfAcclimatization = input.acclimatized ? 0 : 0.1;
  return Math.round(Math.min(1.5, baseline + heatLoad + lackOfAcclimatization) * 10) / 10;
}

/** Wilderness Medical Society heat-illness guidance: replace fluids to thirst and losses without exceeding about 1.5 L/h; long efforts also need food/electrolytes to reduce hyponatremia risk. */
export function hydrationPlan(input: {
  hours: number;
  tempC: number;
  workRate: WorkRate;
}): HydrationPlan | null {
  if (!Number.isFinite(input.hours) || input.hours <= 0 || input.hours > 72) return null;
  const hourly = sweatRateLitersPerHour({
    tempC: input.tempC,
    workRate: input.workRate,
    acclimatized: false,
  });
  if (hourly == null) return null;
  const liters = Math.round(hourly * input.hours * 10) / 10;
  return {
    liters,
    kg: liters,
    note: `Planning estimate: ~${hourly} L/h, capped at 1.5 L/h. Do not force plain water on long efforts; eat normal salty food or use electrolytes as appropriate to reduce hyponatremia risk.`,
  };
}

/** Wilderness Medical Society dehydration and heat-illness guidance: symptoms can overlap with heat illness, so worsening symptoms, confusion, fainting, or inability to drink need urgent evaluation. */
export function dehydrationSigns(): Array<{ stage: string; signs: string[]; action: string }> {
  return [
    {
      stage: "Early",
      signs: ["Thirst", "Dry mouth", "Darkening urine", "Mild headache"],
      action: "Pause in shade, drink to thirst, eat, and reassess the pace.",
    },
    {
      stage: "Worsening",
      signs: ["Marked fatigue", "Dizziness", "Fast pulse", "Very little urine", "Nausea"],
      action: "Stop exertion, cool down, take fluids and food if tolerated, and consider ending the objective.",
    },
    {
      stage: "Emergency",
      signs: ["Confusion", "Fainting", "Collapse", "Inability to keep fluids down", "Hot skin or altered behavior"],
      action: "Treat as a medical emergency: cool, protect airway, activate emergency help, and do not force fluids into an altered person.",
    },
  ];
}

/** Hydration education guidance: urine color is only a rough trend; supplements, food, medicines, and illness can change it. */
export function urineColorGuide(): Array<{ shade: string; meaning: string }> {
  return [
    { shade: "Pale straw", meaning: "Often consistent with adequate hydration; use thirst and overall condition too." },
    { shade: "Light yellow", meaning: "Usually acceptable; continue normal drinking to thirst." },
    { shade: "Dark yellow / amber", meaning: "May indicate dehydration; pause, drink, eat, and reassess heat and pace." },
    { shade: "Tea / cola / red", meaning: "Not a routine hydration signal; seek medical advice, especially with pain, illness, or exertional symptoms." },
  ];
}

/** Wilderness survival and CDC guidance: eating snow consumes core heat; melt it first. Fresh snow often yields roughly 10 volumes of snow for 1 volume of water, but density varies greatly. */
export function snowMeltGuidance(): string[] {
  return [
    "Do not eat snow as your water plan: it consumes core heat and can worsen hypothermia.",
    "Melt snow first. Start with a little liquid water in the pot if possible, then add snow gradually so it does not scorch.",
    "A rough field yield is 10 volumes of fresh snow for 1 volume of water; dense or wet snow yields more, so carry more snow than the rule suggests.",
    "Choose clean, white snow away from roads, camps, animal waste, and visible algae or debris; treat melted water when contamination is possible.",
  ];
}
