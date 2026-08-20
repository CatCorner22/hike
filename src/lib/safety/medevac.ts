import { formatDdm, formatMgrs10, formatUsng, phonetic } from "@/lib/safety/usng";
import type { IceProfile } from "@/lib/safety/profile";

export function nineLineMedevac(input: {
  lat?: number;
  lng?: number;
  trailName?: string;
  profile?: IceProfile | null;
  litter?: number;
  ambulatory?: number;
  precedence?: "A" | "B" | "C";
  marking?: string;
  terrain?: string;
}): string {
  const loc =
    input.lat != null && input.lng != null
      ? `${formatUsng(input.lat, input.lng)} / ${formatMgrs10(input.lat, input.lng)}`
      : "UNKNOWN";
  // Casualty counts, not party size. Defaulting to partySize reported an uninjured
  // group of four as four patients, which is how rescue resources get misallocated.
  const litter = Math.max(0, Math.round(input.litter ?? 0));
  const amb = Math.max(0, Math.round(input.ambulatory ?? (litter > 0 ? 0 : 1)));
  const patients = Math.max(1, litter + amb);
  const prec = input.precedence ?? "B";

  return [
    "9-LINE MEDEVAC / SAR",
    `L1 LOCATION: ${loc}`,
    "L2 FREQ/CALL: SMS/CELL — Hike app",
    `L3 PATIENTS BY PRECEDENCE: ${patients}${prec} (${prec === "A" ? "Urgent" : prec === "B" ? "Priority" : "Routine"})`,
    "L4 SPECIAL EQUIPMENT: None stated",
    `L5 PATIENTS BY TYPE: ${litter}L ${amb}A`,
    "L6 SECURITY: N — civilian wilderness",
    `L7 MARKING: ${input.marking ?? "Phone strobe / voice"}`,
    `L8 NATIONALITY: Civilian${input.profile?.name ? ` (${input.profile.name})` : ""}${input.profile?.partySize ? ` — party of ${input.profile.partySize}` : ""}`,
    `L9 TERRAIN/LZ: ${input.terrain ?? input.trailName ?? "Trail / unknown LZ"}`,
    input.profile?.medical ? `MEDICAL: ${input.profile.medical}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function lostProcedure(): string[] {
  return [
    "STOP — do not walk a bigger circle.",
    "Mark this spot as LKP (last known point).",
    "Terrain associate: ridgeline, drainage, sun, last handrail.",
    "Backtrack on your breadcrumb line if you have one.",
    "If still lost: stay put, run the beacon, send the 9-line.",
  ];
}

export function pacePlan(): string[] {
  return [
    "P — Primary: SMS ICE with USNG",
    "A — Alternate: Share / copy grid",
    "C — Contingency: Voice 9-line over phone when you have signal",
    "E — Emergency: Stay put, beacon, whistle SOS",
  ];
}

export function radioGrid(lat: number, lng: number): string {
  const grid = formatUsng(lat, lng, 5);
  return `${grid}\n${phonetic(grid)}\n${formatDdm(lat, lng)}`;
}
