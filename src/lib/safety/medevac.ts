import { formatDdm, formatMgrs10, formatUsng, phonetic } from "@/lib/safety/usng";
import type { IceProfile } from "@/lib/safety/profile";
import { formatReport, reportField } from "@/lib/safety/report-field";

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
  const grid = input.lat != null && input.lng != null ? formatUsng(input.lat, input.lng) : null;
  const mgrs = input.lat != null && input.lng != null ? formatMgrs10(input.lat, input.lng) : null;
  const loc = grid && mgrs ? `${grid} / ${mgrs}` : "UNKNOWN";
  // Casualty counts, not party size: party size is preserved separately on line 8.
  const litter = Number.isFinite(input.litter) && (input.litter ?? 0) >= 0 ? Math.round(input.litter!) : 0;
  const amb = Number.isFinite(input.ambulatory) && (input.ambulatory ?? 0) >= 0
    ? Math.round(input.ambulatory!)
    : (litter > 0 ? 0 : 1);
  const patients = Math.max(1, litter + amb);
  const prec = input.precedence === "A" || input.precedence === "B" || input.precedence === "C" ? input.precedence : "B";
  const party = Number.isFinite(input.profile?.partySize) && (input.profile?.partySize ?? 0) >= 1
    ? ` — party of ${reportField(Math.round(input.profile!.partySize))}` : "";

  return formatReport([
    "9-LINE MEDEVAC / SAR",
    `L1 LOCATION: ${reportField(loc)}`,
    "L2 FREQ/CALL: SMS/CELL — Hike app",
    `L3 PATIENTS BY PRECEDENCE: ${reportField(patients)}${prec} (${
      prec === "A" ? "Urgent" : prec === "B" ? "Urgent Surgical" : "Priority"
    })`,
    "L4 SPECIAL EQUIPMENT: None stated",
    `L5 PATIENTS BY TYPE: ${reportField(litter)}L ${reportField(amb)}A`,
    "L6 SECURITY: N — civilian wilderness",
    `L7 MARKING: ${reportField(input.marking ?? "Phone strobe / voice")}`,
    `L8 NATIONALITY: Civilian${input.profile?.name ? ` (${reportField(input.profile.name)})` : ""}${party}`,
    `L9 TERRAIN/LZ: ${reportField(input.terrain ?? input.trailName ?? "Trail / unknown LZ")}`,
    input.profile?.medical ? `MEDICAL: ${reportField(input.profile.medical)}` : "",
  ]);
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
  if (!grid) return "UNKNOWN";
  return formatReport([grid, phonetic(grid), formatDdm(lat, lng) ?? "UNKNOWN"]);
}
