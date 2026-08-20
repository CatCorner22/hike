import { z } from "zod";

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

export const trailResearchBriefSchema = z.object({
  summary: z.string().max(PARAGRAPH),
  bestSeasons: z.array(z.string().max(LINE)).max(LIST),
  difficultyReality: z.string().max(PARAGRAPH),
  hazards: z.array(z.string().max(LINE)).max(LIST),
  parking: z.string().max(PARAGRAPH),
  permits: z.string().max(PARAGRAPH).nullable(),
  crowdLevel: z.enum(["low", "moderate", "high"]),
  dogPolicy: z.string().max(LINE).nullable(),
  campingNearby: z.array(z.string().max(LINE)).max(LIST),
  sources: z.array(
    z.object({
      title: z.string().max(LINE),
      // Model output derived from web search results, rendered as an href.
      // Scheme is allow-listed at the render sink by safeSourceUrl below.
      url: z.string().url().max(2_048),
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
export function safeSourceUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}
