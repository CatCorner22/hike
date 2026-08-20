import { hikerNameIssue, iceNameIssue, icePhoneIssue } from "@/lib/safety/field";
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
  const hikerIssue = hikerNameIssue(input.profile.name);
  if (hikerIssue) missing.push(`Your name on the ICE card is unusable: ${hikerIssue}`);
  const iceContactIssue = iceNameIssue(input.profile.iceName);
  if (iceContactIssue) missing.push(`ICE contact is unusable: ${iceContactIssue}`);
  const iceTelephoneIssue = icePhoneIssue(input.profile.icePhone);
  if (iceTelephoneIssue) missing.push(`ICE contact is unusable: ${iceTelephoneIssue}`);
  if (!input.returnAt || !Number.isFinite(Date.parse(input.returnAt))) {
    missing.push("Planned return time");
  }
  return { ok: missing.length === 0, missing };
}
