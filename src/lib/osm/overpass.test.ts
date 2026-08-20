import { describe, expect, it } from "vitest";
import { relationToLineString, type OverpassElement } from "./overpass";

function way(id: number, coordinates: Array<[number, number]>): OverpassElement {
  return { type: "way", id, geometry: coordinates.map(([lon, lat]) => ({ lon, lat })) };
}

describe("relationToLineString", () => {
  it("joins two ways head-to-tail", () => {
    expect(relationToLineString([way(1, [[0, 0], [1, 0]]), way(2, [[1, 0], [2, 0]])])).toEqual({
      type: "LineString", coordinates: [[0, 0], [1, 0], [2, 0]],
    });
  });

  it("reverses a way when needed", () => {
    expect(relationToLineString([way(1, [[0, 0], [1, 0]]), way(2, [[2, 0], [1, 0]])])).toEqual({
      type: "LineString", coordinates: [[0, 0], [1, 0], [2, 0]],
    });
  });

  it("stitches three ways into one path despite arbitrary order", () => {
    expect(relationToLineString([way(2, [[1, 0], [2, 0]]), way(3, [[2, 0], [3, 0]]), way(1, [[0, 0], [1, 0]])])).toEqual({
      type: "LineString", coordinates: [[0, 0], [1, 0], [2, 0], [3, 0]],
    });
  });

  it("keeps genuinely disconnected groups as ordered chains", () => {
    expect(relationToLineString([way(3, [[11, 0], [10, 0]]), way(1, [[0, 0], [1, 0]]), way(2, [[1, 0], [2, 0]]), way(4, [[11, 0], [12, 0]])])).toEqual({
      type: "MultiLineString", coordinates: [
        [[10, 0], [11, 0], [12, 0]], [[0, 0], [1, 0], [2, 0]],
      ],
    });
  });
});

  it("stitches 5,000 disconnected ways without quadratic endpoint scans", () => {
    const ways = Array.from({ length: 5_000 }, (_, id) => way(id, [[-120 + id * 0.01, 38], [-120 + id * 0.01 + 0.00001, 38]]));
    const started = performance.now();
    const result = relationToLineString(ways);
    expect(performance.now() - started).toBeLessThan(500);
    expect(result).toMatchObject({ type: "MultiLineString" });
    expect(result?.type === "MultiLineString" ? result.coordinates : []).toHaveLength(5_000);
  });
