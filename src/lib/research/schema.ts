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
      url: z.string(),
    }),
  ),
  lastResearchedAt: z.string(),
});

export type TrailResearchBrief = z.infer<typeof trailResearchBriefSchema>;
