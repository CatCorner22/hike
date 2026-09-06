import { z } from "zod";
import {
  RESEARCH_EVIDENCE_CLASSES,
  RESEARCH_FRESHNESS_STATES,
} from "@/lib/research/provenance";

/**
 * Every field here is model output derived from untrusted web text, persisted to
 * jsonb, cached for 24 h and then shipped to every client that views the trail.
 * Unbounded strings therefore mean unbounded database growth and unbounded
 * payload to a phone on a dying battery, so each field is capped at a length
 * that is generous for real advice and hostile to abuse.
 */
const LINE = 400;
const PARAGRAPH = 4_000;
const LIST = 20;

const sourceUrlSchema = z.string().url().max(2_048);

const claimSourcesSchema = z.object({
  summary: z.array(sourceUrlSchema).max(LIST),
  bestSeasons: z.array(sourceUrlSchema).max(LIST),
  difficultyReality: z.array(sourceUrlSchema).max(LIST),
  hazards: z.array(sourceUrlSchema).max(LIST),
  parking: z.array(sourceUrlSchema).max(LIST),
  permits: z.array(sourceUrlSchema).max(LIST),
  crowdLevel: z.array(sourceUrlSchema).max(LIST),
  dogPolicy: z.array(sourceUrlSchema).max(LIST),
  campingNearby: z.array(sourceUrlSchema).max(LIST),
});

const modelSourceSchema = z.object({
  label: z.string().max(LINE),
  // Model output derived from web search results, rendered as an href only
  // after server-side allow-listing and provenance assignment.
  url: sourceUrlSchema,
});

const modelBriefSchema = z.object({
  summary: z.string().max(PARAGRAPH),
  bestSeasons: z.array(z.string().max(LINE)).max(LIST),
  difficultyReality: z.string().max(PARAGRAPH),
  hazards: z.array(z.string().max(LINE)).max(LIST),
  parking: z.string().max(PARAGRAPH),
  permits: z.string().max(PARAGRAPH).nullable(),
  crowdLevel: z.enum(["low", "moderate", "high"]),
  dogPolicy: z.string().max(LINE).nullable(),
  campingNearby: z.array(z.string().max(LINE)).max(LIST),
  sources: z.array(modelSourceSchema).max(LIST),
  claimSources: claimSourcesSchema,
});

/**
 * The model can select a source, but it cannot assign it authority or age.
 * Those safety-critical fields are calculated by the application from the URL
 * and retrieval time after the model returns.
 */
export const trailResearchBriefModelSchema = modelBriefSchema;

export const trailResearchBriefSchema = modelBriefSchema.extend({
  sources: z.array(
    modelSourceSchema.extend({
      evidenceClass: z.enum(RESEARCH_EVIDENCE_CLASSES),
      retrievedAt: z.string().max(LINE),
      freshness: z.enum(RESEARCH_FRESHNESS_STATES),
    }),
  ).max(LIST),
  lastResearchedAt: z.string().max(LINE),
});

export type TrailResearchBrief = z.infer<typeof trailResearchBriefSchema>;

/**
 * Source URLs reach the brief by way of the model, which reads attacker-influenceable
 * web-search text. Only http(s) is ever safe to put in an href — everything else
 * (javascript:, data:, file:) is dropped rather than rendered.
 */
export function safeSourceUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}
