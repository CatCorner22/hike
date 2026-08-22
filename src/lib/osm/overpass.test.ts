import { describe, expect, it } from "vitest";
import { buildTrailSearchQuery, relationToLineString, trailGeometryFromElements, type OverpassElement } from "./overpass";

function way(id: number, coordinates: Array<[number, number]>): OverpassElement {
  return { type: "way", id, geometry: coordinates.map(([lon, lat]) => ({ lon, lat })) };
}

describe("buildTrailSearchQuery", () => {
  it("bounds text-only fallback searches to every supported U.S. region", () => {
    const query = buildTrailSearchQuery("Pacific Crest");
    const relationClauses = query.split("\n").filter((line) => line.trim().startsWith("relation["));

    expect(relationClauses).toHaveLength(14);
    expect(relationClauses.every((line) => /\(-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?\);$/.test(line.trim()))).toBe(true);
    expect(query).toContain("(24,-125,50,-66)");
    expect(query).toContain("(-15,-171.5,-10,-168)");
  });

  it("uses only the caller's local bbox when one is supplied", () => {
    const query = buildTrailSearchQuery("Ridge", [-120, 37, -119, 38]);
    const relationClauses = query.split("\n").filter((line) => line.trim().startsWith("relation["));

    expect(relationClauses).toHaveLength(2);
    expect(query).toContain("(37,-120,38,-119)");
    expect(query).not.toContain("(24,-125,50,-66)");
  });
});

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

describe("trailGeometryFromElements", () => {
  it("builds a line from a standalone way with geometry", () => {
    expect(trailGeometryFromElements([way(9, [[-119.5, 37.7], [-119.4, 37.8]])], "way", "9")).toEqual({
      type: "LineString",
      coordinates: [[-119.5, 37.7], [-119.4, 37.8]],
    });
  });

  it("rejects nodes and ways without a usable line", () => {
    expect(trailGeometryFromElements([{ type: "node", id: 1, lat: 37.7, lon: -119.5 }], "node", "1")).toBeNull();
    expect(trailGeometryFromElements([way(9, [[-119.5, 37.7]])], "way", "9")).toBeNull();
  });
});
