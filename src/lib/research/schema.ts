import { z } from "zod";

export const trailResearchBriefSchema = z.object({
  summary: z.string(),
  bestSeasons: z.array(z.string()),
  difficultyReality: z.string(),
  hazards: z.array(z.string()),
  parking: z.string(),
  permits: z.string().nullable(),
  crowdLevel: z.enum(["low", "moderate", "high"]),
  dogPolicy: z.string().nullable(),
  campingNearby: z.array(z.string()),
  sources: z.array(
    z.object({
      title: z.string(),
      // Model output derived from web search results, rendered as an href.
      url: z.string().url(),
    }),
  ),
  lastResearchedAt: z.string(),
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
