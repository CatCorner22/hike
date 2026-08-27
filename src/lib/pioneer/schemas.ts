import { z } from "zod";

export const PIONEER_SUGGESTION_KINDS = [
  "pack",
  "research",
  "weather",
  "readiness",
  "hazard",
  "completeness",
] as const;

export type PioneerSuggestionKind = (typeof PIONEER_SUGGESTION_KINDS)[number];

export const pioneerOsmTagsSchema = z.object({
  sac_scale: z.string().max(80).optional(),
  difficulty: z.string().max(80).optional(),
  hazard: z.string().max(200).optional(),
  exposure: z.string().max(200).optional(),
  ford: z.string().max(40).optional(),
  permit: z.string().max(40).optional(),
  dog: z.string().max(80).optional(),
}).strict();

export type PioneerOsmTags = z.infer<typeof pioneerOsmTagsSchema>;

export const pioneerResearchSliceSchema = z.object({
  present: z.boolean(),
  stale: z.boolean(),
  provenance: z.enum(["source_synthesis", "mapped_metadata_only", "unverified", "absent"]),
  hazardCount: z.number().int().min(0).max(20),
  hazards: z.array(z.string().max(200)).max(8),
  difficultyUnknown: z.boolean(),
  parkingUnknown: z.boolean(),
  permitsUnknown: z.boolean(),
  conditionsUnknown: z.boolean(),
  sourceCount: z.number().int().min(0).max(20),
}).strict();

export const pioneerPackSliceSchema = z.object({
  packReady: z.boolean(),
  tripReady: z.boolean(),
  corridorReady: z.boolean(),
  weather: z.enum(["absent", "fresh", "stale", "unavailable"]),
  weatherSeverity: z.enum(["none", "info", "advisory", "danger"]),
  hazardBrief: z.enum(["absent", "fresh", "stale", "unavailable"]),
  hazardBriefSeverity: z.enum(["none", "info", "watch", "critical"]),
  officialAlerts: z.enum(["absent", "fresh", "stale", "unavailable"]),
  officialAlertCount: z.number().int().min(0).max(40),
  officialAlertMaxSeverity: z.enum([
    "none",
    "unknown",
    "minor",
    "moderate",
    "severe",
    "extreme",
  ]),
  userBailoutCount: z.number().int().min(0).max(20),
}).strict();

export const pioneerReadinessSliceSchema = z.object({
  iceComplete: z.boolean(),
  returnAtSet: z.boolean(),
  gaps: z.array(z.string().max(80)).max(8),
}).strict();

export const pioneerPlanSliceSchema = z.object({
  hasNotes: z.boolean(),
  waypointCount: z.number().int().min(0).max(200),
  plannedDateSet: z.boolean(),
}).strict();

export const pioneerSnapshotSchema = z.object({
  trailName: z.string().min(1).max(200),
  osmTags: pioneerOsmTagsSchema.optional(),
  research: pioneerResearchSliceSchema,
  pack: pioneerPackSliceSchema,
  readiness: pioneerReadinessSliceSchema,
  plan: pioneerPlanSliceSchema.optional(),
}).strict();

export type PioneerSnapshot = z.infer<typeof pioneerSnapshotSchema>;

export const pioneerSuggestionSchema = z.object({
  kind: z.enum(PIONEER_SUGGESTION_KINDS),
  say: z.string().min(1).max(400),
  why: z.string().min(1).max(600),
  evidence: z.string().max(300).optional(),
  question: z.string().max(300).optional(),
  source: z.string().min(3).max(200),
});

export const pioneerModelResponseSchema = z.object({
  suggestions: z.array(pioneerSuggestionSchema).max(3),
});

export type PioneerSuggestion = z.infer<typeof pioneerSuggestionSchema>;
export type PioneerModelResponse = z.infer<typeof pioneerModelResponseSchema>;

function asTrimmed(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

function isKind(value: unknown): value is PioneerSuggestionKind {
  return typeof value === "string"
    && (PIONEER_SUGGESTION_KINDS as readonly string[]).includes(value);
}

export function validatePioneerResponse(raw: unknown): PioneerModelResponse | null {
  if (!raw || typeof raw !== "object") return null;
  const suggestions = (raw as { suggestions?: unknown }).suggestions;
  if (!Array.isArray(suggestions) || suggestions.length > 3) return null;
  const out: PioneerSuggestion[] = [];
  for (const item of suggestions) {
    if (!item || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    if (!isKind(record.kind)) return null;
    const say = asTrimmed(record.say, 400);
    const why = asTrimmed(record.why, 600);
    const source = asTrimmed(record.source, 200);
    if (!say || !why || !source || source.length < 3) return null;
    const suggestion: PioneerSuggestion = { kind: record.kind, say, why, source };
    const evidence = record.evidence === undefined ? undefined : asTrimmed(record.evidence, 300);
    const question = record.question === undefined ? undefined : asTrimmed(record.question, 300);
    if (record.evidence !== undefined && !evidence) return null;
    if (record.question !== undefined && !question) return null;
    if (evidence) suggestion.evidence = evidence;
    if (question) suggestion.question = question;
    out.push(suggestion);
  }
  return { suggestions: out };
}
