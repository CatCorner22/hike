import { describe, expect, it } from "vitest";
import { safeSourceUrl, trailResearchBriefSchema } from "./schema";

/**
 * Source URLs are model output derived from web-search text, which anyone can influence
 * by publishing a page. They are rendered as an href, so the scheme has to be checked.
 */
describe("safeSourceUrl", () => {
  it("keeps ordinary http(s) links", () => {
    expect(safeSourceUrl("https://www.nps.gov/yose")).toBe("https://www.nps.gov/yose");
    expect(safeSourceUrl("http://example.org/trail")).toBe("http://example.org/trail");
  });

  it("drops schemes that can execute or smuggle content", () => {
    expect(safeSourceUrl("javascript:alert(1)")).toBeNull();
    expect(safeSourceUrl("JavaScript:alert(1)")).toBeNull();
    expect(safeSourceUrl("data:text/html;base64,PHNjcmlwdD4=")).toBeNull();
    expect(safeSourceUrl("file:///etc/passwd")).toBeNull();
    expect(safeSourceUrl("vbscript:msgbox(1)")).toBeNull();
  });

  it("drops anything that is not a URL at all", () => {
    expect(safeSourceUrl("")).toBeNull();
    expect(safeSourceUrl("see the park website")).toBeNull();
  });
});

describe("trailResearchBriefSchema", () => {
  const brief = {
    summary: "A trail.",
    bestSeasons: ["Summer"],
    difficultyReality: "Moderate",
    hazards: [],
    parking: "Lot at the trailhead.",
    permits: null,
    crowdLevel: "moderate" as const,
    dogPolicy: null,
    campingNearby: [],
    sources: [{ title: "NPS", url: "https://www.nps.gov/yose" }],
    lastResearchedAt: new Date(0).toISOString(),
  };

  it("accepts a well-formed brief", () => {
    expect(trailResearchBriefSchema.safeParse(brief).success).toBe(true);
  });

  it("rejects a source url that is not a url", () => {
    const bad = { ...brief, sources: [{ title: "NPS", url: "not a url" }] };
    expect(trailResearchBriefSchema.safeParse(bad).success).toBe(false);
  });
});
