import { describe, expect, it } from "vitest";
import {
  isCurrentResearchBrief,
  researchFreshness,
  safeSourceUrl,
  trailResearchBriefSchema,
} from "./schema";

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

  it("accepts explicit unknown crowd evidence", () => {
    expect(trailResearchBriefSchema.safeParse({
      ...brief,
      bestSeasons: [],
      crowdLevel: "unknown",
      conditions: null,
    }).success).toBe(true);
  });

  it("does not treat a legacy cached brief as provenance-aware", () => {
    expect(isCurrentResearchBrief(brief)).toBe(false);
    expect(isCurrentResearchBrief({
      ...brief,
      schemaVersion: 2,
      evidence: { bestSeasons: [], crowdLevel: [], conditions: [] },
      provenance: {
        mode: "mapped_metadata_only",
        parkCode: null,
        parkName: null,
      },
    })).toBe(true);
  });
});

describe("researchFreshness", () => {
  const now = Date.parse("2026-08-22T12:00:00.000Z");

  it("reports the age as a check, not as current conditions", () => {
    expect(researchFreshness("2026-08-22T09:00:00.000Z", now)).toEqual({
      label: "Checked 3h ago",
      stale: false,
    });
    expect(researchFreshness("2026-08-20T12:00:00.000Z", now)).toEqual({
      label: "Checked 2d ago",
      stale: true,
    });
  });

  it("does not trust invalid or future timestamps", () => {
    expect(researchFreshness("not-a-date", now).stale).toBe(true);
    expect(researchFreshness("2026-08-23T12:00:00.000Z", now)).toEqual({
      label: "Research check time unavailable",
      stale: true,
    });
  });
});
