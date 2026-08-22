/**
 * Wilderness SERE (Survival, Evasion, Recovery, Escape) — civilian backcountry focus.
 * Not combat evasion; oriented to staying alive until SAR arrives or you self-rescue.
 */

export type SerePillar = "survival" | "evasion" | "recovery" | "escape";

export interface SereSection {
  pillar: SerePillar;
  title: string;
  bullets: string[];
}

export function sereRuleOfThrees(): string[] {
  return [
    "3 minutes without air (airway / avalanche burial)",
    "3 hours without shelter in cold/wet/wind",
    "3 days without water (less in heat / altitude)",
    "3 weeks without food (you will still make bad decisions before then)",
  ];
}

export function sereSections(): SereSection[] {
  return [
    {
      pillar: "survival",
      title: "Survival — shelter, water, warmth, signal",
      bullets: [
        "STOP: Stop · Think · Observe · Plan (do not walk a bigger circle).",
        "Shelter before dark — hypothermia kills faster than hunger.",
        "Insulate from ground: pad hips/shoulders; break wind first, rain second.",
        "Water: treat if unsure; melt snow slowly; never eat snow as your only water.",
        "Signal in threes: whistle blasts, mirror flashes, strobe, panel letters (V / X).",
        "Fire only where legal and safe — clear ring, no duff, full extinguish before leaving.",
        "Ration calories; sip water on a schedule; rest before you are stupid with fatigue.",
      ],
    },
    {
      pillar: "evasion",
      title: "Evasion — reduce risk, conserve energy (wilderness)",
      bullets: [
        "Stay on durable surfaces when you must move — protect vegetation and yourself from exposure.",
        "Avoid unnecessary creek crossings and cliff bands; handrail ridgelines and drainages you know.",
        "Travel at night only if you must — cold, falls, and losing the trail rise sharply.",
        "Do not split the party; if separated, last known point + rally plan beats wandering.",
        "Cache extra layer, fire kit, and headlamp where you stop — not buried in the pack bottom.",
        "Minimize scent/food attractants at camp; bear-can rules still apply when lost.",
        "If weather closes in: stop early, mark location, wait — movement without visibility is evasion failure.",
      ],
    },
    {
      pillar: "recovery",
      title: "Recovery — mindset and party care",
      bullets: [
        "Talk out loud: name the problem, options, and the next 15-minute task.",
        "Assign roles: navigator, medic, signal, shelter — even solo, write tasks down.",
        "Breathe: 4-count in, 4-count hold, 4-count out before big decisions.",
        "Watch for panic, guilt, and tunnel vision in yourself and others.",
        "Small wins: fire starter lit, one liter treated, one grid copied to ICE.",
        "If injured: treat MARCH, then stay put unless the site is immediately dangerous.",
        "Children / elderly: prioritize warmth and hydration; they cool and dehydrate faster.",
      ],
    },
    {
      pillar: "escape",
      title: "Escape — self-rescue when SAR is not imminent",
      bullets: [
        "Self-rescue only if you know where you are going and can still navigate safely.",
        "Backtrack breadcrumbs / nav log before cross-country shortcuts.",
        "Follow downstream only if cliffs and waterfalls are likely — often traps you.",
        "Follow sun / known handrail (road, power line, river you mapped) with pace count.",
        "Leave notes at junctions (time, direction, party status) if you must move.",
        "When you regain signal: send USNG + status before celebrating.",
        "If unsure: stay put, improve shelter, and activate your physical PLB or satellite SOS if carried. The phone locator does not transmit.",
      ],
    },
  ];
}

export function serePriorities(isDark: boolean, tempC?: number): string[] {
  const cold = tempC != null && tempC < 5;
  const base = ["1. Airway / bleeding", "2. Shelter / warmth", "3. Signal", "4. Water", "5. Food"];
  if (isDark || cold) {
    return [
      "Cold / dark — flip order:",
      "1. Shelter + insulation NOW",
      "2. Signal (strobe / whistle / SOS text if signal returns)",
      "3. Water (warm drinks if you can)",
      "4. Food after you are warm",
    ];
  }
  return base;
}

export function sereShelterChecklist(): string[] {
  return [
    "Site: flat, drained, not in a gully (flash flood / cold sink)",
    "Wind break first — rock, berm, or dense trees",
    "Rain: tarp / bivy / space blanket roof, not just over your face",
    "Ground pad: pack, branches, extra clothes — conductivity kills",
    "Ventilation if using a shelter — condensation wets you overnight",
    "Mark the site for SAR: bright panel, reflective, cleared signal lane",
  ];
}

export function sereWaterGuidance(): string[] {
  return [
    "Running water over still; upstream of camps and livestock if possible",
    "Filter + chemical treat + boil when you can — giardia is a multi-day problem",
    "Snow: melt in pot, not in mouth — costs core temperature",
    "Desert: rest in shade midday; drink on schedule, not only when thirsty",
    "Urine dark yellow = dehydrating; headache + nausea = slow down",
  ];
}

export function sereSignalingMethods(): string[] {
  return [
    "Electronic: SOS sheet, strobe, SMS USNG, share location",
    "Audible: 3 whistle blasts, pause, repeat",
    "Visual day: mirror / phone screen toward aircraft, bright panel, smoke (safe!)",
    "Visual night: strobe, headlamp toward aircraft, not at other hikers' eyes",
    "Ground: V (need help), X (need medical), large letters ≥ 3 m, high contrast",
    "Stay in open ground periodically so sound and light carry",
  ];
}

export function sereStayPutCard(): string[] {
  return [
    "If lost or hurt: STOP. Do not random walk.",
    "Mark LKP; send grid if you have any signal.",
    "Shelter before dark — insulation beats calories.",
    "Signal in threes: whistle, mirror, strobe, panel letters.",
    "Make yourself big and contrasty from the air.",
    "Ration water; eat before decision-making fails.",
  ];
}

export function sereAssessment(input: {
  isDark?: boolean;
  altitudeM?: number;
  stationaryMin?: number;
  hasSignal?: boolean;
  partySize?: number;
}): string | null {
  const lines: string[] = [];
  if (input.isDark) {
    lines.push("Dark — build shelter and signal capability before moving again.");
  }
  if ((input.altitudeM ?? 0) >= 2500 && (input.stationaryMin ?? 0) >= 10) {
    lines.push("High and still — watch altitude illness and core temperature.");
  }
  if ((input.stationaryMin ?? 0) >= 30 && !input.hasSignal) {
    lines.push("Long stop without signal — prioritize insulation, water schedule, and hourly whistle.");
  }
  if ((input.partySize ?? 1) >= 4 && (input.stationaryMin ?? 0) >= 15) {
    lines.push("Large party stopped — assign shelter, water, signal, and nav roles now.");
  }
  if (lines.length === 0) return null;
  return `SERE: ${lines.join(" ")}`;
}

export function sereQuickCard(input?: {
  lat?: number;
  lng?: number;
  isDark?: boolean;
}): string {
  const sections = sereSections();
  const lines = [
    "WILDERNESS SERE CARD",
    input?.lat != null && input?.lng != null
      ? `LKP grid: use Safety sheet USNG`
      : "Set LKP from Safety sheet when GPS is available",
    "",
    "RULE OF THREES",
    ...sereRuleOfThrees().map((l) => `· ${l}`),
    "",
  ];
  for (const sec of sections) {
    lines.push(sec.title.toUpperCase());
    lines.push(...sec.bullets.map((b) => `· ${b}`));
    lines.push("");
  }
  lines.push("STAY PUT (when in doubt)");
  lines.push(...sereStayPutCard().map((b) => `· ${b}`));
  if (input?.isDark) {
    lines.push("");
    lines.push("NIGHT PRIORITIES");
    lines.push(...serePriorities(true).map((p) => `· ${p}`));
  }
  return lines.join("\n");
}
