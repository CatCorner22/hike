import { formatReport, reportField } from "@/lib/safety/report-field";

export const HARVEST_DISCLAIMER =
  "Training reference only. Follow all hunting/trapping laws, seasons, and tags where you are. " +
  "Never consume wild meat you cannot identify or that shows signs of disease. " +
  "This is not a substitute for hunter education or food-safety guidance.";

export function survivalHarvestPriorities(): string[] {
  return [
    "Signal and shelter beat hunting when SAR is likely within 72 hours.",
    "Calories from insects, fish, and small game are safer than a wounded large animal.",
    "Never hunt near your shelter — blood and gut piles attract predators.",
    "Cook all wild meat thoroughly; trichinosis and bacteria kill slower than hunger.",
  ];
}

export function huntingBasics(): string[] {
  return [
    "Legal: tags, seasons, weapon restrictions, and no-go zones apply even in survival.",
    "Ethics: positive ID, safe backstop, know what is beyond the target.",
    "Small game first: rabbit, squirrel, grouse — less energy and less risk than big game.",
    "Stalk into the wind; stop at cover; one clean shot beats wounding and tracking.",
    "If you wound an animal, mark last blood, grid, and time — do not leave a suffering animal.",
    "Avoid gut-shot meat near viscera; discard heavily contaminated tissue.",
  ];
}

export function trappingBasics(): string[] {
  return [
    "Survival trapping is low yield — set many small sets while you still have calories.",
    "Location: trails, den entrances, funnel between rocks, along creek banks.",
    "Figure-4 deadfall: baited trigger; check every few hours; mark sets for your party.",
    "Snare: wire or cord loop on a game trail; suspend so the noose closes upward.",
    "Never set traps where other hikers, pets, or SAR dogs will step in.",
    "Check traps before dark — caught animals attract bears and coyotes.",
  ];
}

export function gameFieldDressing(): string[] {
  return [
    "Bleed promptly; keep meat clean and cool from the start.",
    "Gloves if you have them — zoonotic disease is real.",
    "Skin or gut within 2 hours in warm weather; sooner in heat.",
    "Do not puncture stomach or bladder — contamination spoils meat fast.",
    "Quarter large animals if you must pack out; hang meat off ground and away from flies.",
    "Remove scent glands on deer-family animals before handling meat.",
    "Pack heart/liver only if cooling is assured — they spoil first.",
  ];
}

export function cookingWildGame(): string[] {
  return [
    "Cook to 165°F (74°C) internal for all wild mammals and birds.",
    "No pink poultry; bear, boar, and carnivore meat must be well done (trichinosis risk).",
    "Boil if you lack a thermometer — rolling boil 15+ minutes for stew cuts.",
    "Smoke-drying alone is not enough unless you know the technique and climate.",
    "Never eat raw freshwater fish in survival — parasites are common.",
    "If meat smells sour, green, or maggoty — discard. Food poisoning outranks hunger.",
  ];
}

export function survivalHarvestAssessment(input: {
  daysLost?: number;
  tempC?: number;
  hasFire?: boolean;
}): string | null {
  const lines: string[] = [];
  if ((input.daysLost ?? 0) < 2) {
    lines.push("Early lost — prioritize signal and shelter over hunting.");
  }
  if (input.tempC != null && input.tempC < 0 && !input.hasFire) {
    lines.push("Below freezing without fire — build shelter and heat before expending calories hunting.");
  }
  if (lines.length === 0) return null;
  return `Harvest: ${lines.join(" ")}`;
}

export function formatHarvestCard(): string {
  return formatReport([
    "SURVIVAL HARVEST CARD",
    reportField(HARVEST_DISCLAIMER),
    "PRIORITIES",
    ...survivalHarvestPriorities().map((l) => `· ${l}`),
    "HUNTING",
    ...huntingBasics().map((l) => `· ${l}`),
    "TRAPPING",
    ...trappingBasics().map((l) => `· ${l}`),
    "FIELD DRESSING",
    ...gameFieldDressing().map((l) => `· ${l}`),
    "COOKING",
    ...cookingWildGame().map((l) => `· ${l}`),
  ]);
}
