import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  SOURCE_SYNTHESIS_SUMMARY,
  UNKNOWN_SOURCE_DIFFICULTY,
} from "@/lib/research/schema";
import { ResearchBrief } from "./research-brief";

const completeEmptyEvidence = {
  summary: [],
  bestSeasons: [],
  difficultyReality: [],
  hazards: [],
  parking: [],
  permits: [],
  crowdLevel: [],
  conditions: [],
  dogPolicy: [],
  campingNearby: [],
};

describe("ResearchBrief", () => {
  it("hides claims from legacy v2 briefs without complete field evidence", () => {
    const html = renderToStaticMarkup(createElement(ResearchBrief, {
      brief: {
        schemaVersion: 2,
        summary: "Definitely safe year-round.",
        bestSeasons: ["Any season"],
        difficultyReality: "Easy for everyone.",
        hazards: ["No hazards"],
        parking: "Parking is guaranteed.",
        permits: "No permit required.",
        crowdLevel: "low",
        conditions: "All clear.",
        dogPolicy: "Dogs always allowed.",
        campingNearby: ["Camp anywhere"],
        sources: [{ title: "Unrelated source", url: "https://example.com" }],
        evidence: { bestSeasons: [], crowdLevel: [], conditions: [] },
        provenance: {
          mode: "mapped_metadata_only",
          parkCode: null,
          parkName: null,
        },
        lastResearchedAt: "2026-08-22T12:00:00.000Z",
      },
    }));

    expect(html).toContain("predates source verification");
    expect(html).toContain("verified difficulty evidence is unavailable");
    expect(html).not.toContain("Definitely safe year-round");
    expect(html).not.toContain("Easy for everyone");
    expect(html).not.toContain("No hazards");
    expect(html).not.toContain("Parking is guaranteed");
    expect(html).not.toContain("No permit required");
    expect(html).not.toContain("All clear");
    expect(html).not.toContain("Dogs always allowed");
    expect(html).not.toContain("Camp anywhere");
    expect(html).not.toContain("Unrelated source");
  });

  it("hides every unsupported claim even when all evidence keys are present", () => {
    const html = renderToStaticMarkup(createElement(ResearchBrief, {
      brief: {
        schemaVersion: 2,
        summary: SOURCE_SYNTHESIS_SUMMARY,
        bestSeasons: ["Any season"],
        difficultyReality: "Easy for everyone.",
        hazards: ["No hazards"],
        parking: "Parking is guaranteed.",
        permits: "No permit required.",
        crowdLevel: "low",
        conditions: "All clear.",
        dogPolicy: "Dogs always allowed.",
        campingNearby: ["Camp anywhere"],
        sources: [],
        evidence: completeEmptyEvidence,
        provenance: {
          mode: "source_synthesis",
          parkCode: null,
          parkName: null,
        },
        lastResearchedAt: "2026-08-22T12:00:00.000Z",
      },
    }));

    expect(html).toContain(SOURCE_SYNTHESIS_SUMMARY);
    expect(html).toContain("verified difficulty evidence is unavailable");
    expect(html).not.toContain("Any season");
    expect(html).not.toContain("Easy for everyone");
    expect(html).not.toContain("No hazards");
    expect(html).not.toContain("Parking is guaranteed");
    expect(html).not.toContain("No permit required");
    expect(html).not.toContain("All clear");
    expect(html).not.toContain("Dogs always allowed");
    expect(html).not.toContain("Camp anywhere");
  });

  it("keeps a supported field while independently hiding an unsupported sibling", () => {
    const sourceUrl = "https://example.gov/trail";
    const html = renderToStaticMarkup(createElement(ResearchBrief, {
      brief: {
        schemaVersion: 2,
        summary: SOURCE_SYNTHESIS_SUMMARY,
        bestSeasons: [],
        difficultyReality: UNKNOWN_SOURCE_DIFFICULTY,
        hazards: ["Loose rock."],
        parking: "Parking is guaranteed.",
        permits: null,
        crowdLevel: "unknown",
        conditions: null,
        dogPolicy: null,
        campingNearby: [],
        sources: [{ title: "Official trail bulletin", url: sourceUrl, provider: "web" }],
        evidence: {
          ...completeEmptyEvidence,
          hazards: [sourceUrl],
        },
        provenance: {
          mode: "source_synthesis",
          parkCode: null,
          parkName: null,
        },
        lastResearchedAt: "2026-08-22T12:00:00.000Z",
      },
    }));

    expect(html).toContain("Loose rock.");
    expect(html).toContain("Official trail bulletin");
    expect(html).not.toContain("Parking is guaranteed");
    expect(html).toContain("verified parking evidence is unavailable");
    expect(html).toContain("Unverified brief — refresh");
  });
});
