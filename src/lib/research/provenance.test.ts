import { describe, expect, it } from "vitest";
import {
  RESEARCH_SOURCE_AGING_MS,
  RESEARCH_SOURCE_FRESH_MS,
  classifyResearchClaim,
  classifyResearchSourceUrl,
  researchSourceFreshness,
} from "@/lib/research/provenance";

describe("classifyResearchClaim", () => {
  it("labels all model-authored brief text as AI-inferred, even when it has citations", () => {
    expect(classifyResearchClaim()).toBe("ai-inferred");
  });
});

describe("classifyResearchSourceUrl", () => {
  it("classifies government and land-manager domains as official", () => {
    expect(classifyResearchSourceUrl("https://www.nps.gov/yose/planyourvisit/conditions.htm")).toBe("official");
    expect(classifyResearchSourceUrl("https://alerts.fs.usda.gov/detail/arp/alerts-notices")).toBe("official");
    expect(classifyResearchSourceUrl("https://www.recreation.gov/permits")).toBe("official");
  });

  it("recognizes a .gov subdomain without accepting a lookalike suffix", () => {
    expect(classifyResearchSourceUrl("https://trails.county.gov/closures")).toBe("official");
    expect(classifyResearchSourceUrl("https://county.gov.example.com/closures")).toBe("unverified");
  });

  it("classifies known community sources", () => {
    expect(classifyResearchSourceUrl("https://www.alltrails.com/trail/us/california/example")).toBe("community");
    expect(classifyResearchSourceUrl("https://en.wikipedia.org/wiki/Example_Trail")).toBe("community");
    expect(classifyResearchSourceUrl("https://www.openstreetmap.org/way/123")).toBe("community");
  });

  it("never grants official status to invalid, non-web, or unknown URLs", () => {
    for (const value of [
      undefined,
      null,
      "",
      "not a URL",
      "javascript:alert(1)",
      "https://nps.gov.example.com/conditions",
      "https://example.org/trail",
    ]) {
      expect(classifyResearchSourceUrl(value)).toBe("unverified");
    }
  });
});

describe("researchSourceFreshness", () => {
  const retrievedAt = "2026-08-20T12:00:00.000Z";
  const retrievedMs = Date.parse(retrievedAt);

  it("reports the documented freshness boundaries explicitly", () => {
    expect(researchSourceFreshness(retrievedAt, retrievedMs)).toBe("fresh");
    expect(researchSourceFreshness(retrievedAt, retrievedMs + RESEARCH_SOURCE_FRESH_MS)).toBe("fresh");
    expect(researchSourceFreshness(retrievedAt, retrievedMs + RESEARCH_SOURCE_FRESH_MS + 1)).toBe("aging");
    expect(researchSourceFreshness(retrievedAt, retrievedMs + RESEARCH_SOURCE_AGING_MS)).toBe("aging");
    expect(researchSourceFreshness(retrievedAt, retrievedMs + RESEARCH_SOURCE_AGING_MS + 1)).toBe("stale");
  });

  it("returns unknown for missing, malformed, future, and non-finite times", () => {
    for (const value of [undefined, null, "", "not a date", "NaN-NaN-NaNTNaN:NaN"]) {
      expect(researchSourceFreshness(value, retrievedMs)).toBe("unknown");
    }

    expect(researchSourceFreshness(retrievedAt, Number.NaN)).toBe("unknown");
    expect(researchSourceFreshness(retrievedAt, retrievedMs - 1)).toBe("unknown");
  });

  it("does not return fresh when either input is garbage", () => {
    expect(researchSourceFreshness({}, Number.POSITIVE_INFINITY)).not.toBe("fresh");
    expect(researchSourceFreshness("invalid", Number.NaN)).not.toBe("fresh");
  });
});
