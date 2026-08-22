import { describe, expect, it } from "vitest";
import {
  buildMappedMetadataBrief,
  sanitizeGeneratedBrief,
  type TrustedResearchSource,
} from "./agent";

const generated = {
  summary: "Source summary.",
  bestSeasons: ["Summer"],
  difficultyReality: "Moderate.",
  hazards: ["Loose rock."],
  parking: "Small lot.",
  permits: null,
  crowdLevel: "moderate" as const,
  conditions: "Dry at publication time.",
  dogPolicy: null,
  campingNearby: [],
  sources: [{ title: "Model title", url: "https://example.gov/trail" }],
  evidence: {
    bestSeasons: ["https://example.gov/trail"],
    crowdLevel: ["https://example.gov/trail"],
    conditions: ["https://example.gov/trail"],
  },
};

describe("buildMappedMetadataBrief", () => {
  it("leaves season, crowd, and conditions unknown instead of inventing defaults", () => {
    const brief = buildMappedMetadataBrief({
      trailName: "Example Trail",
      osm: { type: "relation", id: "123" },
      tags: { sac_scale: "mountain_hiking" },
    }, null, new Date("2026-08-22T12:00:00.000Z"));

    expect(brief.bestSeasons).toEqual([]);
    expect(brief.crowdLevel).toBe("unknown");
    expect(brief.conditions).toBeNull();
    expect(brief.parking).toMatch(/^Unknown/);
    expect(brief.provenance?.mode).toBe("mapped_metadata_only");
    expect(brief.sources).toEqual([{
      title: "OpenStreetMap trail record",
      url: "https://www.openstreetmap.org/relation/123",
      provider: "openstreetmap",
    }]);
  });
});

describe("sanitizeGeneratedBrief", () => {
  const trusted: TrustedResearchSource[] = [
    {
      title: "Official trail bulletin",
      url: "https://example.gov/trail",
      provider: "web",
    },
    {
      title: "OpenStreetMap trail record",
      url: "https://www.openstreetmap.org/relation/123",
      provider: "openstreetmap",
    },
  ];

  it("erases sensitive claims when their cited URL was not fetched", () => {
    const brief = sanitizeGeneratedBrief({
      ...generated,
      sources: [{ title: "Invented", url: "https://invented.example/trail" }],
      evidence: {
        bestSeasons: ["https://invented.example/trail"],
        crowdLevel: ["https://invented.example/trail"],
        conditions: ["https://invented.example/trail"],
      },
    }, trusted, null);

    expect(brief.bestSeasons).toEqual([]);
    expect(brief.crowdLevel).toBe("unknown");
    expect(brief.conditions).toBeNull();
    expect(brief.sources).toEqual([]);
    expect(brief.evidence).toEqual({
      bestSeasons: [],
      crowdLevel: [],
      conditions: [],
    });
  });

  it("keeps claims with allow-listed external evidence and code-owned provenance", () => {
    const brief = sanitizeGeneratedBrief(
      generated,
      trusted,
      { parkCode: "yose", name: "Yosemite National Park" },
      new Date("2026-08-22T12:00:00.000Z"),
    );

    expect(brief.bestSeasons).toEqual(["Summer"]);
    expect(brief.crowdLevel).toBe("moderate");
    expect(brief.conditions).toBe("Dry at publication time.");
    expect(brief.sources).toEqual([trusted[0]]);
    expect(brief.provenance).toEqual({
      mode: "source_synthesis",
      parkCode: "yose",
      parkName: "Yosemite National Park",
    });
  });

  it("does not accept OpenStreetMap alone as crowd, season, or condition evidence", () => {
    const osmUrl = "https://www.openstreetmap.org/relation/123";
    const brief = sanitizeGeneratedBrief({
      ...generated,
      sources: [{ title: "OSM", url: osmUrl }],
      evidence: {
        bestSeasons: [osmUrl],
        crowdLevel: [osmUrl],
        conditions: [osmUrl],
      },
    }, trusted, null);

    expect(brief.bestSeasons).toEqual([]);
    expect(brief.crowdLevel).toBe("unknown");
    expect(brief.conditions).toBeNull();
  });
});
