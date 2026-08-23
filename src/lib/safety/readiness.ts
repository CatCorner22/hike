import { hikerNameIssue, iceNameIssue, icePhoneIssue } from "@/lib/safety/field";
import type { IceProfile } from "@/lib/safety/profile";

export interface ReadinessInput {
  packReady: boolean;
  profile: IceProfile;
  returnAt: string | null;
}

/**
 * One thing that is not set up.
 *
 * Two audiences, so two strings. The form that fixes it needs the validator's
 * full complaint; the running banner on the navigate screen needs something it
 * can join into a sentence. Joining the detailed strings produced the seams a
 * hiker was actually shown -- "ICE contact is unusable: ICE phone is required.,
 * Planned return time." -- so the two are now separate by construction rather
 * than by whoever remembers to reword at the call site.
 */
export interface ReadinessGap {
  /** Imperative, no terminal punctuation, safe to join with commas. */
  label: string;
  /** The validator's own words, for the field that fixes it. */
  detail: string;
}

export interface ReadinessResult {
  ok: boolean;
  missing: ReadinessGap[];
}

/** The gaps as one readable clause, e.g. "a return time, a working ICE phone number". */
export function summarizeGaps(gaps: ReadonlyArray<ReadinessGap>): string {
  return gaps.map((gap) => gap.label).join(", ");
}

export function hikeReadiness(input: ReadinessInput): ReadinessResult {
  const missing: ReadinessGap[] = [];
  if (!input.packReady) {
    missing.push({
      label: "the offline route on this device",
      detail: "Offline route pack on this device",
    });
  }
  const hikerIssue = hikerNameIssue(input.profile.name);
  if (hikerIssue) {
    missing.push({
      label: "your name",
      detail: `Your name on the ICE card is unusable: ${hikerIssue}`,
    });
  }
  const iceContactIssue = iceNameIssue(input.profile.iceName);
  if (iceContactIssue) {
    missing.push({
      label: "an emergency contact name",
      detail: `ICE contact is unusable: ${iceContactIssue}`,
    });
  }
  const iceTelephoneIssue = icePhoneIssue(input.profile.icePhone);
  if (iceTelephoneIssue) {
    missing.push({
      label: "a working emergency contact number",
      detail: `ICE contact is unusable: ${iceTelephoneIssue}`,
    });
  }
  if (!input.returnAt || !Number.isFinite(Date.parse(input.returnAt))) {
    missing.push({ label: "a planned return time", detail: "Planned return time" });
  }
  return { ok: missing.length === 0, missing };
}
