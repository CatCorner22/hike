// PIONEER MODE ROUTER — deterministic strictness from the PREP SNAPSHOT.
//
// SuperByte classifies draft text; Spirit classifies session state. Pioneer
// classifies the structured snapshot. The model is never asked to grade its
// own risk.

import type { PioneerSnapshot } from "./schemas";

export type PioneerMode =
  | "standard"
  | "pack-gap"
  | "research-stale"
  | "weather"
  | "water"
  | "avalanche"
  | "ice-gap";

export type PioneerProfileId = "standard" | "caution" | "strict";

export interface PioneerProfile {
  id: PioneerProfileId;
  minReads: number;
  unanimous: boolean;
}

const AVALANCHE_RE = /\bavalanch/i;
const WATER_RE = /\b(ford|creek crossing|river crossing|swift water|water hazard)\b/i;

export function resolveModes(snapshot: PioneerSnapshot): PioneerMode[] {
  const modes: PioneerMode[] = ["standard"];
  if (!snapshot.pack.packReady) modes.push("pack-gap");
  if (
    !snapshot.research.present
    || snapshot.research.stale
    || snapshot.research.provenance === "absent"
    || snapshot.research.provenance === "unverified"
  ) {
    modes.push("research-stale");
  }
  if (
    snapshot.pack.weatherSeverity === "advisory"
    || snapshot.pack.weatherSeverity === "danger"
    || snapshot.pack.hazardBriefSeverity === "watch"
    || snapshot.pack.hazardBriefSeverity === "critical"
    || snapshot.pack.officialAlertMaxSeverity === "severe"
    || snapshot.pack.officialAlertMaxSeverity === "extreme"
  ) {
    modes.push("weather");
  }
  const tagBlob = Object.values(snapshot.osmTags ?? {}).join(" ");
  const hazardBlob = snapshot.research.hazards.join(" ");
  if (
    snapshot.osmTags?.ford === "yes"
    || WATER_RE.test(tagBlob)
    || WATER_RE.test(hazardBlob)
  ) {
    modes.push("water");
  }
  if (AVALANCHE_RE.test(tagBlob) || AVALANCHE_RE.test(hazardBlob)) {
    modes.push("avalanche");
  }
  if (!snapshot.readiness.iceComplete || !snapshot.readiness.returnAtSet) {
    modes.push("ice-gap");
  }
  return modes;
}

export function resolveProfile(modes: PioneerMode[]): PioneerProfile {
  const highRisk = modes.filter((mode) => mode !== "standard");
  if (
    highRisk.includes("avalanche")
    || (highRisk.includes("weather") && highRisk.includes("pack-gap"))
  ) {
    return { id: "strict", minReads: 2, unanimous: true };
  }
  if (highRisk.length > 0) {
    return { id: "caution", minReads: 2, unanimous: false };
  }
  return { id: "standard", minReads: 1, unanimous: false };
}

const STRONG_CLAIM_RE =
  /\b(?:must\b|required?\b|requires\b|violat\w+|illegal|prohibited?\b|not\s+permitted|never\s+allowed|mandat\w+|do not (?:hike|go))\b/i;

export function hasStrongClaim(say: string, why: string): boolean {
  return STRONG_CLAIM_RE.test(say) || STRONG_CLAIM_RE.test(why);
}

export function strictPromptAddendum(profile: PioneerProfile, modes: PioneerMode[]): string {
  if (profile.id === "standard") return "";
  const domain = modes.filter((mode) => mode !== "standard").join(" + ");
  return `STRICT READ (${domain}): prefer neutral questions over assertions. Do not propose a go/no-go. Every claim needs a named authority in "source". If unsure, ask.`;
}
