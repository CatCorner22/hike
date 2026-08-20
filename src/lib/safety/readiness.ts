import { isIceFilled } from "@/lib/safety/field";
import type { IceProfile } from "@/lib/safety/profile";

export interface ReadinessInput {
  packReady: boolean;
  profile: IceProfile;
  returnAt: string | null;
}

export interface ReadinessResult {
  ok: boolean;
  missing: string[];
}

export function hikeReadiness(input: ReadinessInput): ReadinessResult {
  const missing: string[] = [];
  if (!input.packReady) missing.push("Offline route pack on this device");
  if (!input.profile.name.trim()) missing.push("Your name on the ICE card");
  if (!isIceFilled(input.profile)) missing.push("ICE name and phone");
  if (!input.returnAt || !Number.isFinite(Date.parse(input.returnAt))) {
    missing.push("Planned return time");
  }
  return { ok: missing.length === 0, missing };
}
