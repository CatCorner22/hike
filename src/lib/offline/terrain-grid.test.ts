import { describe, expect, it } from "vitest";
import {
  TERRAIN_MAX_SAMPLES,
  TERRAIN_MIN_COVERAGE,
  TERRAIN_MIN_SPACING_M,
  TERRAIN_SAMPLES_PER_REQUEST,
  chunkTerrainPoints,
  hillshade,
  isUsableTerrainGrid,
  planTerrainGrid,
  terrainCoverage,
  terrainLegend,
  type TerrainGrid,
} from "./terrain-grid";

/** Roughly a 6 km × 5 km corridor around Yosemite Valley. */
const YOSEMITE: [number, number, number, number] = [-119.64, 37.72, -119.57, 37.77];

function gridFrom(elevations: Array<number | null>, cols: number, rows: number): TerrainGrid {
  return {
    bbox: YOSEMITE,
    cols,
    rows,
    elevations,
    spacingMeters: 200,
    source: "open-elevation",
    fetchedAt: "2026-08-23T00:00:00.000Z",
  };
}

describe("the sample plan stays inside what the app is willing to spend", () => {
  it("never exceeds the sample budget, so it never exceeds three requests", () => {
    const plan = planTerrainGrid(YOSEMITE);
    expect(plan).not.toBeNull();
    expect(plan!.points.length).toBe(plan!.cols * plan!.rows);
    expect(plan!.points.length).toBeLessThanOrEqual(TERRAIN_MAX_SAMPLES);
    expect(chunkTerrainPoints(plan!.points).length).toBeLessThanOrEqual(3);
    expect(chunkTerrainPoints(plan!.points).every((c) => c.length <= TERRAIN_SAMPLES_PER_REQUEST)).toBe(true);
  });

  it("holds the budget on a long thin corridor, which is what an out-and-back is", () => {
    // 70 km east-west, 200 m north-south. This produced 617 columns floored to
    // two rows -- 1,234 samples against a budget of 1,200, and a fourth request
    // to a free public service.
    for (const bbox of [
      [-119.9, 37.749, -119.1, 37.751],
      [-120.5, 37.7, -119.0, 37.72],
      [-119.61, 37.0, -119.6, 38.0],
    ] as Array<[number, number, number, number]>) {
      const plan = planTerrainGrid(bbox);
      expect(plan, `no plan for ${bbox.join(",")}`).not.toBeNull();
      expect(plan!.points.length, `over budget for ${bbox.join(",")}`).toBeLessThanOrEqual(
        TERRAIN_MAX_SAMPLES,
      );
      expect(chunkTerrainPoints(plan!.points).length).toBeLessThanOrEqual(3);
      // And still at least two rows, or there is no cross-slope to shade.
      expect(plan!.rows).toBeGreaterThanOrEqual(2);
      expect(plan!.cols).toBeGreaterThanOrEqual(2);
    }
  });

  it("never claims a spacing finer than the source can support", () => {
    // A tiny corridor would otherwise be sampled every few metres off 30 m data.
    const tiny = planTerrainGrid([-119.601, 37.7501, -119.6, 37.7502]);
    expect(tiny?.spacingMeters ?? 0).toBeGreaterThanOrEqual(TERRAIN_MIN_SPACING_M);
  });

  it("keeps cells roughly square on the ground, not in degrees", () => {
    // At 60°N a degree of longitude is half a degree of latitude. A grid laid
    // out in degrees would be stretched two to one and shade the relief wrong.
    const north = planTerrainGrid([-100, 59.9, -99.8, 60.0]);
    expect(north).not.toBeNull();
    const midLat = 59.95;
    const widthM = 0.2 * (Math.PI / 180) * 6_371_000 * Math.cos((midLat * Math.PI) / 180);
    const heightM = 0.1 * (Math.PI / 180) * 6_371_000;
    const cellW = widthM / (north!.cols - 1);
    const cellH = heightM / (north!.rows - 1);
    expect(cellW / cellH).toBeGreaterThan(0.5);
    expect(cellW / cellH).toBeLessThan(2);
  });

  it("puts the north row first, which is how it is stored and drawn", () => {
    const plan = planTerrainGrid(YOSEMITE)!;
    expect(plan.points[0].lat).toBeCloseTo(YOSEMITE[3], 6);
    expect(plan.points[plan.points.length - 1].lat).toBeCloseTo(YOSEMITE[1], 6);
    expect(plan.points[0].lng).toBeCloseTo(YOSEMITE[0], 6);
  });

  it("refuses a degenerate or impossible box rather than sampling a strip", () => {
    expect(planTerrainGrid([-119.6, 37.75, -119.6, 37.75])).toBeNull();
    expect(planTerrainGrid([-119.5, 37.75, -119.6, 37.8])).toBeNull();
    expect(planTerrainGrid([Number.NaN, 37.75, -119.5, 37.8])).toBeNull();
    // The Mercator-ish maths this app uses everywhere breaks down at the poles.
    expect(planTerrainGrid([-119.6, 86, -119.5, 87])).toBeNull();
  });
});

/**
 * A half-answered grid shades half the map and leaves the rest blank, which
 * reads as flat ground rather than as missing data.
 */
describe("a grid is only kept if enough of it came back", () => {
  it("measures coverage honestly", () => {
    expect(terrainCoverage(gridFrom([1, 2, null, 4], 2, 2))).toBe(0.75);
    expect(terrainCoverage(gridFrom([null, null, null, null], 2, 2))).toBe(0);
  });

  it("rejects a grid below the coverage floor", () => {
    const sparse = gridFrom([1, null, null, null], 2, 2);
    expect(terrainCoverage(sparse)).toBeLessThan(TERRAIN_MIN_COVERAGE);
    expect(isUsableTerrainGrid(sparse)).toBe(false);
  });

  it("accepts a grid with a few holes", () => {
    expect(isUsableTerrainGrid(gridFrom([1200, 1300, 1400, 1500, null, 1600, 1700, 1800, 1900], 3, 3))).toBe(true);
  });
});

/**
 * This comes back out of IndexedDB, which is untrusted storage like any other.
 */
describe("a grid from storage is validated before it is drawn", () => {
  const good = gridFrom([1, 2, 3, 4], 2, 2);

  it("accepts a well-formed grid", () => {
    expect(isUsableTerrainGrid(good)).toBe(true);
  });

  it("rejects a length that disagrees with its own dimensions", () => {
    expect(isUsableTerrainGrid({ ...good, elevations: [1, 2, 3] })).toBe(false);
  });

  it("rejects a spacing finer than the source supports, which would be a lie", () => {
    expect(isUsableTerrainGrid({ ...good, spacingMeters: 5 })).toBe(false);
  });

  it("rejects a grid larger than the budget, whatever it claims", () => {
    const cols = 100;
    const rows = 20;
    expect(
      isUsableTerrainGrid({
        ...good,
        cols,
        rows,
        elevations: new Array(cols * rows).fill(1000),
      }),
    ).toBe(false);
  });

  it("rejects nonsense", () => {
    expect(isUsableTerrainGrid(null)).toBe(false);
    expect(isUsableTerrainGrid({ ...good, bbox: [1, 2, 3] })).toBe(false);
    expect(isUsableTerrainGrid({ ...good, bbox: [-119.5, 37.8, -119.6, 37.7] })).toBe(false);
    expect(isUsableTerrainGrid({ ...good, elevations: [1, 2, "3", 4] })).toBe(false);
    expect(isUsableTerrainGrid({ ...good, fetchedAt: "not a date" })).toBe(false);
    expect(isUsableTerrainGrid({ ...good, source: "" })).toBe(false);
  });
});

/**
 * People read north-west lighting as raised. Getting the sign wrong inverts
 * every ridge into a gully, which is worse than drawing nothing.
 */
describe("the shading reads the way a map reader expects", () => {
  const flat = gridFrom(new Array(25).fill(1500), 5, 5);

  it("gives flat ground one uniform tone", () => {
    const shade = hillshade(flat);
    expect(new Set(shade.map((value) => value!.toFixed(6))).size).toBe(1);
  });

  it("lights a north-west-facing slope more than a south-east-facing one", () => {
    // A ridge running north-east: the north-west flank faces the light.
    const cols = 5;
    const rows = 5;
    const ridge: number[] = [];
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        // Peak along the anti-diagonal.
        ridge.push(1500 + 100 * (4 - Math.abs(col - (rows - 1 - row))));
      }
    }
    const shade = hillshade(gridFrom(ridge, cols, rows));
    // North-west of the crest versus south-east of it, same distance out.
    const northWest = shade[1 * cols + 1]!;
    const southEast = shade[3 * cols + 3]!;
    expect(northWest).toBeGreaterThan(southEast);
  });

  it("stays between fully shadowed and fully lit", () => {
    const steep = gridFrom([0, 0, 0, 3000, 3000, 3000, 0, 0, 0], 3, 3);
    for (const value of hillshade(steep)) {
      expect(value).not.toBeNull();
      expect(value!).toBeGreaterThanOrEqual(0);
      expect(value!).toBeLessThanOrEqual(1);
    }
  });

  it("leaves a hole as a hole, never as flat ground", () => {
    const holed = gridFrom([1500, 1500, 1500, 1500, null, 1500, 1500, 1500, 1500], 3, 3);
    const shade = hillshade(holed);
    expect(shade[4]).toBeNull();
    expect(shade.filter((value) => value != null).length).toBe(8);
  });
});

describe("the map never shows this without saying what it is", () => {
  it("states the sample spacing and refuses the word topo", () => {
    const legend = terrainLegend(gridFrom([1, 2, 3, 4], 2, 2));
    expect(legend).toMatch(/200 m samples/);
    expect(legend).toMatch(/not a topo map/);
    expect(legend).toMatch(/No cliff narrower than that exists here/);
  });
});
