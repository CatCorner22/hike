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
  const loc =
    input.lat != null && input.lng != null
      ? `${formatUsng(input.lat, input.lng)} / ${formatMgrs10(input.lat, input.lng)}`
      : "UNKNOWN";
  const patients = Number.isFinite(input.profile?.partySize) && (input.profile?.partySize ?? 0) >= 1 ? input.profile!.partySize : 1;
  const litter = Number.isFinite(input.litter) && (input.litter ?? 0) >= 0 ? input.litter! : 0;
  const amb = input.ambulatory ?? Math.max(patients - litter, 0);
  const prec = input.precedence === "A" || input.precedence === "B" || input.precedence === "C" ? input.precedence : "B";

  return formatReport([
    "9-LINE MEDEVAC / SAR",
    `L1 LOCATION: ${reportField(loc)}`,
    "L2 FREQ/CALL: SMS/CELL — Hike app",
    `L3 PATIENTS BY PRECEDENCE: ${reportField(patients)}${prec} (${prec === "A" ? "Urgent" : prec === "B" ? "Priority" : "Routine"})`,
    "L4 SPECIAL EQUIPMENT: None stated",
    `L5 PATIENTS BY TYPE: ${reportField(litter)}L ${reportField(Number.isFinite(amb) && amb >= 0 ? amb : "UNKNOWN")}A`,
    "L6 SECURITY: N — civilian wilderness",
    `L7 MARKING: ${reportField(input.marking ?? "Phone strobe / voice")}`,
    `L8 NATIONALITY: Civilian${input.profile?.name ? ` (${reportField(input.profile.name)})` : ""}`,
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
