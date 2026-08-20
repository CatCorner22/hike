import { describe, expect, it } from "vitest";
import {
  creepingLineLegs,
  expandingSquareLegs,
  expandingSquareLine,
  formatSearchPlan,
  parallelTrackLegs,
} from "./search";

describe("search patterns", () => {
  it("builds an expanding square with doubling legs", () => {
    const legs = expandingSquareLegs(100, 2);
    expect(legs[0].meters).toBe(100);
    expect(legs[2].meters).toBe(200);
    expect(legs[0].cumMeters).toBeLessThan(legs[legs.length - 1].cumMeters);
  });

  it("returns a line string from a center", () => {
    const line = expandingSquareLine({ lat: 37, lng: -119 }, 50, 1)!;
    expect(line.coordinates.length).toBeGreaterThan(2);
  });

  it("formats a search plan", () => {
    const text = formatSearchPlan("expanding square", expandingSquareLegs(100, 1));
    expect(text).toContain("EXPANDING SQUARE SEARCH");
  });

  it("builds a creeping line with cross-track offsets", () => {
    const legs = creepingLineLegs(200, 40, 3, 90);
    expect(legs[0].headingTrue).toBe(90);
    expect(legs.some((l) => l.meters === 40)).toBe(true);
  });

  it("builds parallel tracks", () => {
    expect(parallelTrackLegs(300, 50, 2).length).toBeGreaterThan(2);
  });
});
