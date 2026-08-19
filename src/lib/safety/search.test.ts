import { describe, expect, it } from "vitest";
import { expandingSquareLegs, expandingSquareLine, formatSearchPlan } from "./search";

describe("search patterns", () => {
  it("builds an expanding square with doubling legs", () => {
    const legs = expandingSquareLegs(100, 2);
    expect(legs[0].meters).toBe(100);
    expect(legs[2].meters).toBe(200);
    expect(legs[0].cumMeters).toBeLessThan(legs[legs.length - 1].cumMeters);
  });

  it("returns a line string from a center", () => {
    const line = expandingSquareLine({ lat: 37, lng: -119 }, 50, 1);
    expect(line.coordinates.length).toBeGreaterThan(2);
  });

  it("formats a search plan", () => {
    const text = formatSearchPlan("expanding square", expandingSquareLegs(100, 1));
    expect(text).toContain("EXPANDING SQUARE SEARCH");
  });
});
