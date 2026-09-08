import { describe, expect, it } from "vitest";
import {
  buildMappedMetadataBrief,
  sanitizeGeneratedBrief,
  type TrustedResearchSource,
} from "./agent";
import { isCurrentResearchBrief, SOURCE_SYNTHESIS_SUMMARY } from "./schema";

const SOURCE_URL = "https://example.gov/trail";
const SOURCE_TEXT =
  "Official bulletin: Summer is recommended. Difficulty is Moderate. Loose rock. Small lot. Permit required. Crowd level is moderate. Dry at publication time. Leashed dogs allowed. Backcountry campground.";

function citation(url = SOURCE_URL, excerpt = SOURCE_TEXT) {
  return { url, excerpt };
}

const generated = {
  summary: "The model cannot control this summary.",
  bestSeasons: ["Summer"],
  difficultyReality: "Moderate.",
  hazards: ["Loose rock."],
  parking: "Small lot.",
  permits: "Permit required.",
  crowdLevel: "moderate" as const,
  conditions: "Dry at publication time.",
  dogPolicy: "Leashed dogs allowed.",
  campingNearby: ["Backcountry campground."],
  sources: [{ title: "Model title", url: SOURCE_URL }],
  evidence: {
    summary: [],
    bestSeasons: [citation()],
    difficultyReality: [citation()],
    hazards: [citation()],
    parking: [citation()],
    permits: [citation()],
    crowdLevel: [citation()],
    conditions: [citation()],
    dogPolicy: [citation()],
    campingNearby: [citation()],
  },
};

describe("buildMappedMetadataBrief", () => {
  it("preserves deterministic OSM facts while leaving unsupported fields unknown", () => {
    const brief = buildMappedMetadataBrief({
      trailName: "Example Trail",
      osm: { type: "relation", id: "123" },
      tags: {
        sac_scale: "mountain_hiking",
        hazard: "rockfall",
        permit: "yes",
        dog: "leashed",
      },
    }, null, new Date("2026-08-22T12:00:00.000Z"));

    expect(brief.bestSeasons).toEqual([]);
    expect(brief.crowdLevel).toBe("unknown");
    expect(brief.conditions).toBeNull();
    expect(brief.difficultyReality).toContain("mountain_hiking");
    expect(brief.hazards).toContain("OpenStreetMap hazard tag: rockfall");
    expect(brief.permits).toContain("permit requirement");
    expect(brief.dogPolicy).toContain("leashed");
    expect(brief.parking).toMatch(/^Unknown/);
    expect(brief.provenance?.mode).toBe("mapped_metadata_only");
    expect(isCurrentResearchBrief(brief)).toBe(true);
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
      url: SOURCE_URL,
      provider: "web",
      content: SOURCE_TEXT,
    },
    {
      title: "OpenStreetMap trail record",
      url: "https://www.openstreetmap.org/relation/123",
      provider: "openstreetmap",
    },
  ];

  it("erases claims when their cited URL was not fetched", () => {
    const inventedUrl = "https://invented.example/trail";
    const invented = citation(inventedUrl);
    const brief = sanitizeGeneratedBrief({
      ...generated,
      sources: [{ title: "Invented", url: inventedUrl }],
      evidence: {
        summary: [],
        bestSeasons: [invented],
        difficultyReality: [invented],
        hazards: [invented],
        parking: [invented],
        permits: [invented],
        crowdLevel: [invented],
        conditions: [invented],
        dogPolicy: [invented],
        campingNearby: [invented],
      },
    }, trusted, null);

    expect(brief.summary).toBe(SOURCE_SYNTHESIS_SUMMARY);
    expect(brief.bestSeasons).toEqual([]);
    expect(brief.difficultyReality).toMatch(/^Unknown/);
    expect(brief.hazards).toEqual([]);
    expect(brief.parking).toMatch(/^Unknown/);
    expect(brief.permits).toBeNull();
    expect(brief.crowdLevel).toBe("unknown");
    expect(brief.conditions).toBeNull();
    expect(brief.dogPolicy).toBeNull();
    expect(brief.campingNearby).toEqual([]);
    expect(brief.sources).toEqual([]);
    expect(Object.values(brief.evidence ?? {}).every((urls) => urls?.length === 0)).toBe(true);
  });

  it("keeps verbatim claims with server-verified excerpts and code-owned provenance", () => {
    const brief = sanitizeGeneratedBrief(
      generated,
      trusted,
      { parkCode: "yose", name: "Yosemite National Park" },
      new Date("2026-08-22T12:00:00.000Z"),
    );

    expect(brief.summary).toBe(SOURCE_SYNTHESIS_SUMMARY);
    expect(brief.bestSeasons).toEqual(["Summer"]);
    expect(brief.difficultyReality).toBe("Moderate.");
    expect(brief.hazards).toEqual(["Loose rock."]);
    expect(brief.parking).toBe("Small lot.");
    expect(brief.permits).toBe("Permit required.");
    expect(brief.crowdLevel).toBe("moderate");
    expect(brief.conditions).toBe("Dry at publication time.");
    expect(brief.dogPolicy).toBe("Leashed dogs allowed.");
    expect(brief.campingNearby).toEqual(["Backcountry campground."]);
    expect(brief.sources).toEqual([{
      title: "Official trail bulletin",
      url: SOURCE_URL,
      provider: "web",
    }]);
    expect(brief.provenance).toEqual({
      mode: "source_synthesis",
      parkCode: "yose",
      parkName: "Yosemite National Park",
    });
    expect(isCurrentResearchBrief(brief)).toBe(true);
  });

  it("does not accept OpenStreetMap as model evidence", () => {
    const osmUrl = "https://www.openstreetmap.org/relation/123";
    const osm = citation(osmUrl);
    const brief = sanitizeGeneratedBrief({
      ...generated,
      evidence: {
        summary: [],
        bestSeasons: [osm],
        difficultyReality: [osm],
        hazards: [osm],
        parking: [osm],
        permits: [osm],
        crowdLevel: [osm],
        conditions: [osm],
        dogPolicy: [osm],
        campingNearby: [osm],
      },
    }, trusted, null);

    expect(brief.bestSeasons).toEqual([]);
    expect(brief.difficultyReality).toMatch(/^Unknown/);
    expect(brief.hazards).toEqual([]);
    expect(brief.parking).toMatch(/^Unknown/);
    expect(brief.permits).toBeNull();
    expect(brief.crowdLevel).toBe("unknown");
    expect(brief.conditions).toBeNull();
    expect(brief.dogPolicy).toBeNull();
    expect(brief.campingNearby).toEqual([]);
  });

  it("keeps only fields with their own verified excerpt", () => {
    const brief = sanitizeGeneratedBrief({
      ...generated,
      evidence: {
        summary: [],
        bestSeasons: [],
        difficultyReality: [],
        hazards: [citation()],
        parking: [],
        permits: [],
        crowdLevel: [],
        conditions: [],
        dogPolicy: [],
        campingNearby: [],
      },
    }, trusted, null);

    expect(brief.summary).toBe(SOURCE_SYNTHESIS_SUMMARY);
    expect(brief.bestSeasons).toEqual([]);
    expect(brief.difficultyReality).toMatch(/^Unknown/);
    expect(brief.hazards).toEqual(["Loose rock."]);
    expect(brief.parking).toMatch(/^Unknown/);
    expect(brief.permits).toBeNull();
    expect(brief.crowdLevel).toBe("unknown");
    expect(brief.conditions).toBeNull();
    expect(brief.dogPolicy).toBeNull();
    expect(brief.campingNearby).toEqual([]);
    expect(brief.sources).toEqual([{
      title: "Official trail bulletin",
      url: SOURCE_URL,
      provider: "web",
    }]);
  });

  it("rejects an allow-listed URL whose verified excerpt does not contain the claim", () => {
    const url = "https://example.gov/history";
    const content =
      "This official page contains only a history of the trail and its dedication ceremony.";
    const evidence = citation(url, content);
    const brief = sanitizeGeneratedBrief({
      ...generated,
      evidence: {
        summary: [],
        bestSeasons: [],
        difficultyReality: [],
        hazards: [evidence],
        parking: [evidence],
        permits: [],
        crowdLevel: [],
        conditions: [],
        dogPolicy: [],
        campingNearby: [],
      },
    }, [{ title: "Trail history", url, provider: "web", content }], null);

    expect(brief.hazards).toEqual([]);
    expect(brief.parking).toMatch(/^Unknown/);
    expect(brief.evidence?.hazards).toEqual([]);
    expect(brief.evidence?.parking).toEqual([]);
    expect(brief.sources).toEqual([]);
  });

  it("drops claims whose evidence source falls outside the final 20 displayed sources", () => {
    const sources = Array.from({ length: 21 }, (_, index) => {
      const claim = index < 20
        ? `Hazard report ${index + 1}: loose rock.`
        : "Campground 21 is open.";
      return {
        title: `Source ${index + 1}`,
        url: `https://example.gov/${index + 1}`,
        provider: "web" as const,
        content: `Official field bulletin confirms: ${claim}`,
        claim,
      };
    });
    const hazardSources = sources.slice(0, 20);
    const campingSource = sources[20];
    const brief = sanitizeGeneratedBrief({
      ...generated,
      bestSeasons: [],
      difficultyReality: "Unknown",
      hazards: hazardSources.map((source) => source.claim),
      parking: "Unknown",
      permits: null,
      crowdLevel: "unknown",
      conditions: null,
      dogPolicy: null,
      campingNearby: [campingSource.claim],
      evidence: {
        summary: [],
        bestSeasons: [],
        difficultyReality: [],
        hazards: hazardSources.map((source) => citation(source.url, source.content)),
        parking: [],
        permits: [],
        crowdLevel: [],
        conditions: [],
        dogPolicy: [],
        campingNearby: [citation(campingSource.url, campingSource.content)],
      },
    }, sources, null);

    expect(brief.sources).toHaveLength(20);
    expect(brief.hazards).toHaveLength(20);
    expect(brief.campingNearby).toEqual([]);
    expect(brief.evidence?.campingNearby).toEqual([]);
    expect(brief.sources.some((source) => source.url === campingSource.url)).toBe(false);
  });
});
