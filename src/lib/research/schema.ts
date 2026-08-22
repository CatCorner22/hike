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

export const researchEvidenceSchema = z.object({
  bestSeasons: z.array(z.string().url().max(2_048)).max(LIST),
  crowdLevel: z.array(z.string().url().max(2_048)).max(LIST),
  conditions: z.array(z.string().url().max(2_048)).max(LIST),
});

export const researchSourceSchema = z.object({
  title: z.string().max(LINE),
  // Model output derived from web search results, rendered as an href.
  // Scheme is allow-listed at the render sink by safeSourceUrl below.
  url: z.string().url().max(2_048),
  provider: z.enum(["openstreetmap", "nps", "web"]).optional(),
});

export const trailResearchBriefSchema = z.object({
  schemaVersion: z.literal(2).optional(),
  summary: z.string().max(PARAGRAPH),
  bestSeasons: z.array(z.string().max(LINE)).max(LIST),
  difficultyReality: z.string().max(PARAGRAPH),
  hazards: z.array(z.string().max(LINE)).max(LIST),
  parking: z.string().max(PARAGRAPH),
  permits: z.string().max(PARAGRAPH).nullable(),
  crowdLevel: z.enum(["low", "moderate", "high", "unknown"]),
  conditions: z.string().max(PARAGRAPH).nullable().optional(),
  dogPolicy: z.string().max(LINE).nullable(),
  campingNearby: z.array(z.string().max(LINE)).max(LIST),
  sources: z.array(researchSourceSchema).max(LIST),
  evidence: researchEvidenceSchema.optional(),
  provenance: z.object({
    mode: z.enum(["source_synthesis", "mapped_metadata_only"]),
    parkCode: z.string().regex(/^[a-z]{4}$/).nullable(),
    parkName: z.string().max(LINE).nullable(),
  }).optional(),
  lastResearchedAt: z.string().max(LINE),
});

export type TrailResearchBrief = z.infer<typeof trailResearchBriefSchema>;

export interface ResearchFreshness {
  label: string;
  stale: boolean;
}

/**
 * The check time is not the observation time of every source. This helper
 * deliberately says "checked" rather than "current" and treats timestamps
 * far in the future as untrusted instead of letting them hide stale data.
 */
export function researchFreshness(
  researchedAt: string,
  nowMs = Date.now(),
): ResearchFreshness {
  const researchedMs = Date.parse(researchedAt);
  if (!Number.isFinite(researchedMs) || researchedMs > nowMs + 5 * 60 * 1_000) {
    return { label: "Research check time unavailable", stale: true };
  }

  const ageMs = Math.max(0, nowMs - researchedMs);
  const hours = Math.floor(ageMs / (60 * 60 * 1_000));
  if (hours < 1) return { label: "Checked less than an hour ago", stale: false };
  if (hours < 24) return { label: `Checked ${hours}h ago`, stale: false };

  const days = Math.floor(hours / 24);
  return { label: `Checked ${days}d ago`, stale: true };
}

/** Only v2 briefs carry code-owned provenance and field evidence. */
export function isCurrentResearchBrief(value: unknown): value is TrailResearchBrief {
  const parsed = trailResearchBriefSchema.safeParse(value);
  return Boolean(
    parsed.success
      && parsed.data.schemaVersion === 2
      && parsed.data.provenance
      && parsed.data.evidence,
  );
}

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
