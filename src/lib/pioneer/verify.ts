import { detectEscape } from "./escape";
import { isAllowedSource } from "./public";
import type { PioneerSnapshot, PioneerSuggestion } from "./schemas";

const EVIDENCE_REQUIRED_KINDS = new Set(["research", "hazard"]);
const SNAPSHOT_KINDS = new Set(["pack", "readiness", "completeness"]);

/** Decimal degrees or degree-marked angles in any published Pioneer field. */
export const COORDINATE_RE = /\b-?\d{1,3}\.\d{3,}\b|\b\d{1,3}°/;

// `n't` must not use a leading \b — in hasn't/doesn't the n sits after a word character.
const NEGATION_RE = /\b(?:not|no|missing|absent|without|never|unset|incomplete)\b|n't/i;
const PACK_TOPIC_RE = /\b(?:offline(?:\s+route)?\s+pack|route pack|offline pack)\b/i;
const PACK_CUE_RE = /\b(?:on this device|present|ready|prepared|loaded|cached)\b/i;
const ICE_TOPIC_RE = /\b(?:ice(?:\s+card)?|emergency contact|in-?case-of-emergency)\b/i;
const ICE_CUE_RE = /\b(?:complete|set|filled|ready|present)\b/i;
const RETURN_TOPIC_RE = /\b(?:return time|return-at|planned return)\b/i;
const RETURN_CUE_RE = /\b(?:set|present|filled|ready|complete)\b/i;
const PREP_TOPIC_RE = /\b(?:prep|get-home state|hike is|trip is)\b/i;
const PREP_CUE_RE = /\b(?:complete|ready to (?:go|hike|leave)|fully prepared|on course)\b/i;

export function displayedPioneerFields(suggestion: PioneerSuggestion): string[] {
  return [
    suggestion.say,
    suggestion.why,
    suggestion.question,
    suggestion.source,
    suggestion.evidence,
  ].filter((part): part is string => Boolean(part));
}

export function suggestionHasCoordinates(suggestion: PioneerSuggestion): boolean {
  return displayedPioneerFields(suggestion).some((part) => COORDINATE_RE.test(part));
}

function sentencesOf(text: string): string[] {
  return text.split(/[.!?;\n]+/).map((part) => part.trim()).filter(Boolean);
}

function sentencePolarity(
  sentence: string,
  topic: RegExp,
  cue: RegExp,
): "pos" | "neg" | null {
  if (!topic.test(sentence) || !cue.test(sentence)) return null;
  return NEGATION_RE.test(sentence) ? "neg" : "pos";
}

const INTERROGATIVE_RE = /^(?:is|are|has|have|can|could|does|do|was|were|should)\b/i;

function anyAssertedPolarity(
  text: string,
  topic: RegExp,
  cue: RegExp,
  polarity: "pos" | "neg",
): boolean {
  for (const sentence of sentencesOf(text)) {
    if (INTERROGATIVE_RE.test(sentence)) continue;
    if (sentencePolarity(sentence, topic, cue) === polarity) return true;
  }
  return false;
}

/**
 * Reject pack / readiness / completeness assertions that disagree with the
 * deterministic snapshot. Questions are not claims — only `say` and `why`.
 */
export function suggestionContradictsSnapshot(
  snapshot: PioneerSnapshot,
  suggestion: PioneerSuggestion,
): boolean {
  if (!SNAPSHOT_KINDS.has(suggestion.kind)) return false;
  const asserted = `${suggestion.say} ${suggestion.why}`;

  if (suggestion.kind === "pack" || suggestion.kind === "completeness") {
    if (anyAssertedPolarity(asserted, PACK_TOPIC_RE, PACK_CUE_RE, "pos") && !snapshot.pack.packReady) {
      return true;
    }
    if (anyAssertedPolarity(asserted, PACK_TOPIC_RE, PACK_CUE_RE, "neg") && snapshot.pack.packReady) {
      return true;
    }
  }

  if (suggestion.kind === "readiness" || suggestion.kind === "completeness") {
    if (anyAssertedPolarity(asserted, ICE_TOPIC_RE, ICE_CUE_RE, "pos") && !snapshot.readiness.iceComplete) {
      return true;
    }
    if (anyAssertedPolarity(asserted, ICE_TOPIC_RE, ICE_CUE_RE, "neg") && snapshot.readiness.iceComplete) {
      return true;
    }
    if (anyAssertedPolarity(asserted, RETURN_TOPIC_RE, RETURN_CUE_RE, "pos") && !snapshot.readiness.returnAtSet) {
      return true;
    }
    if (anyAssertedPolarity(asserted, RETURN_TOPIC_RE, RETURN_CUE_RE, "neg") && snapshot.readiness.returnAtSet) {
      return true;
    }
  }

  if (suggestion.kind === "completeness") {
    const incomplete = !snapshot.pack.packReady
      || !snapshot.pack.tripReady
      || !snapshot.pack.corridorReady
      || !snapshot.readiness.iceComplete
      || !snapshot.readiness.returnAtSet;
    if (anyAssertedPolarity(asserted, PREP_TOPIC_RE, PREP_CUE_RE, "pos") && incomplete) return true;
    if (anyAssertedPolarity(asserted, PREP_TOPIC_RE, PREP_CUE_RE, "neg") && !incomplete) return true;
  }

  return false;
}

export function verifySuggestion(
  parseContext: string,
  snapshot: PioneerSnapshot,
  suggestion: PioneerSuggestion,
): string | null {
  if (!isAllowedSource(suggestion.source)) return "source-not-allowed";
  if (suggestionHasCoordinates(suggestion)) return "nav-math";
  if (detectEscape(displayedPioneerFields(suggestion).join(" ")).length > 0) {
    return "escape-model";
  }
  if (SNAPSHOT_KINDS.has(suggestion.kind)) {
    const question = suggestion.question || suggestion.say;
    if (!/\?/.test(question)) return "gap-not-question";
    if (suggestionContradictsSnapshot(snapshot, suggestion)) return "snapshot-contradiction";
  }
  if (EVIDENCE_REQUIRED_KINDS.has(suggestion.kind) && !suggestion.evidence) {
    return "missing-evidence";
  }
  if (suggestion.evidence && !parseContext.includes(suggestion.evidence)) {
    return "ungrounded-evidence";
  }
  return null;
}
