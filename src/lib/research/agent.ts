import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { getResearchContext } from "@/lib/nps/client";
import { fetchWithTimeout } from "@/lib/api/outbound";
import {
  trailResearchBriefSchema,
  type TrailResearchBrief,
} from "@/lib/research/schema";

interface ResearchInput {
  trailName: string;
  location?: { lat: number; lng: number };
  parkCode?: string;
  wikipediaUrl?: string;
  tags?: Record<string, string>;
}

async function searchWeb(query: string): Promise<Array<{ title: string; url: string; content: string }>> {
  const tavilyKey = process.env.TAVILY_API_KEY;
  if (!tavilyKey) return [];

  try {
    const response = await fetchWithTimeout("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: tavilyKey,
        query,
        search_depth: "basic",
        max_results: 8,
        include_answer: false,
      }),
    }, 5_000);

    if (!response.ok) return [];
    const data = await response.json();
    return (data.results || []).map(
      (r: { title: string; url: string; content: string }) => ({
        title: r.title,
        url: r.url,
        content: r.content?.slice(0, 1500) || "",
      }),
    );
  } catch {
    return [];
  }
}

function buildFallbackBrief(input: ResearchInput): TrailResearchBrief {
  const tags = input.tags || {};
  const hazards: string[] = [];
  if (tags.sac_scale) hazards.push(`SAC scale: ${tags.sac_scale}`);
  if (tags.exposure) hazards.push(`Exposure: ${tags.exposure}`);

  return {
    summary: `${input.trailName} is a hiking route mapped on OpenStreetMap. Configure OPENAI_API_KEY and TAVILY_API_KEY for AI-consolidated trail research from web and NPS sources.`,
    bestSeasons: ["Spring", "Summer", "Fall"],
    difficultyReality: tags.difficulty || tags.sac_scale || "Difficulty not rated in OSM data",
    hazards,
    parking: "Check park or trailhead website for current parking requirements.",
    permits: tags.permit === "yes" ? "Permit may be required — verify with land manager." : null,
    crowdLevel: "moderate",
    dogPolicy: tags.dog || null,
    campingNearby: [],
    sources: input.wikipediaUrl
      ? [{ title: "Wikipedia", url: input.wikipediaUrl }]
      : [],
    lastResearchedAt: new Date().toISOString(),
  };
}

export async function researchTrail(input: ResearchInput): Promise<TrailResearchBrief> {
  const apiKey = process.env.OPENAI_API_KEY || process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) {
    return buildFallbackBrief(input);
  }

  const searchQuery = `${input.trailName} hiking trail reviews conditions parking permits`;
  const [webResults, npsContext] = await Promise.all([
    searchWeb(searchQuery),
    getResearchContext(input.trailName, input.parkCode),
  ]);

  const contextParts = [
    `Trail: ${input.trailName}`,
    input.location
      ? `Location: ${input.location.lat}, ${input.location.lng}`
      : "",
    input.wikipediaUrl ? `Wikipedia: ${input.wikipediaUrl}` : "",
    input.tags ? `OSM tags: ${JSON.stringify(input.tags)}` : "",
    "",
    "Web search results:",
    ...webResults.map(
      (r) => `- ${r.title} (${r.url}): ${r.content}`,
    ),
    "",
    "NPS articles:",
    ...npsContext.articles.map((a) => `- ${a.title}: ${a.content}`),
    "",
    "NPS alerts:",
    ...npsContext.alerts.map((a) => `- ${a.title}: ${a.content}`),
  ].filter(Boolean);

  try {
    const { object } = await generateObject({
      model: openai("gpt-4o-mini"),
      schema: trailResearchBriefSchema.omit({ lastResearchedAt: true }),
      prompt: `You are an expert hiking guide. Synthesize the following sources into an actionable trail research brief. Be specific about hazards, parking, permits, best seasons, and realistic difficulty. Cite sources in the sources array.

${contextParts.join("\n")}`,
    });

    return {
      ...object,
      lastResearchedAt: new Date().toISOString(),
    };
  } catch {
    return buildFallbackBrief(input);
  }
}
