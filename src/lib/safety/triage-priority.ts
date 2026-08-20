import type { DescentImperativeResult } from "@/lib/safety/altitude";
import type { MedicalOverride } from "@/lib/safety/tactics";

export type GoverningAction = "urgent-assisted-descent" | "stay" | "short-carry" | "walk-out";

export function medicalOverrideFromAltitude(
  result: Pick<DescentImperativeResult, "mustDescend">,
): MedicalOverride | undefined {
  return result.mustDescend ? "severe-altitude-illness" : undefined;
}

/** Produce one governing order rather than displaying independent, contradictory recommendations. */
export function reconcileTriagePriority(input: {
  altitude: Pick<DescentImperativeResult, "mustDescend" | "message">;
  movement: { choice: GoverningAction; reason: string; medicalPriority?: boolean };
}): { action: GoverningAction; message: string; conflicts: string[] } {
  if (input.altitude.mustDescend) {
    const conflicts = input.movement.choice === "stay"
      ? ["Generic stay-put advice conflicts with a severe-altitude descent imperative and is overridden."]
      : [];
    return {
      action: "urgent-assisted-descent",
      message: "MEDICAL PRIORITY: urgent assisted descent/evacuation and rescue activation govern. Terrain safety still matters; do not apply a generic stay-put rule.",
      conflicts,
    };
  }
  return { action: input.movement.choice, message: input.movement.reason, conflicts: [] };
}
