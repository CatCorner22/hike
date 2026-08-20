import { describe, expect, it } from "vitest";
import {
  creepingLineLegs,
  expandingSquareLegs,
  expandingSquareLine,
  formatSearchPlan,
  parallelTrackLegs,
  searchLineFromLegs,
  sectorSearchLegs,
  sectorSearchLine,
} from "./search";
import * as turf from "@turf/turf";

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

describe("a sweep has to actually sweep", () => {
  const start = { lat: 37.7, lng: -119.6 };

  /** How wide a corridor the drawn track actually covers, perpendicular to a due-north axis. */
  function sweptWidthM(line: GeoJSON.LineString | null) {
    if (!line) return 0;
    const lngs = line.coordinates.map((c) => c[0]);
    const lat = line.coordinates[0][1];
    return turf.distance(
      turf.point([Math.min(...lngs), lat]),
      turf.point([Math.max(...lngs), lat]),
      { units: "meters" },
    );
  }

  /**
   * The creeping line stepped right, then left, then right — straight back onto
   * the track it had just left. Four passes covered a 50 m corridor instead of
   * 150 m and six covered 50 m instead of 250 m, while the searcher walked the
   * full distance and the plan reported the wider corridor as swept.
   */
  it("covers one more track spacing for every extra pass", () => {
    for (const [passes, expectedWidth] of [[2, 50], [4, 150], [6, 250], [8, 350]] as const) {
      for (const legs of [
        creepingLineLegs(200, 50, passes, 0),
        parallelTrackLegs(200, 50, passes, 0),
      ]) {
        const width = sweptWidthM(searchLineFromLegs(start, legs));
        expect(width, `${passes} passes`).toBeGreaterThan(expectedWidth - 5);
        expect(width, `${passes} passes`).toBeLessThan(expectedWidth + 5);
      }
    }
  });

  it("never steps back over ground it just left", () => {
    for (const axis of [0, 45, 137, 270]) {
      for (const legs of [creepingLineLegs(200, 50, 6, axis), parallelTrackLegs(200, 50, 6, axis)]) {
        const across = legs.filter((leg) => leg.meters === 50).map((leg) => leg.headingTrue);
        expect(across.length, `axis ${axis}`).toBe(5);
        // Every sideways step goes the same way, or the pattern does not advance.
        expect(new Set(across).size, `axis ${axis}`).toBe(1);
      }
    }
  });

  it("draws the sector pattern the same way its legs describe it", () => {
    const legs = sectorSearchLegs(300, 0, 3);
    const chained = searchLineFromLegs(start, legs);
    const line = sectorSearchLine(start, 300, 0, 3);
    expect(line).toEqual(chained);
    // Three equal legs 120 deg apart close the triangle back onto the datum.
    const last = line!.coordinates[line!.coordinates.length - 1];
    expect(turf.distance(turf.point([start.lng, start.lat]), turf.point(last), { units: "meters" }))
      .toBeLessThan(1);
  });
});
