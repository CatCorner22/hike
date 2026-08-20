import { describe, expect, it } from "vitest";
import { buildTerrainCorridorSpec, corridorCoverageLabel, DEFAULT_TERRAIN_CORRIDOR_METERS } from "./terrain-corridor";

const route: GeoJSON.LineString = { type: "LineString", coordinates: [[-83.92, 35.96], [-83.90, 35.98]] };

describe("terrain corridor", () => {
  it("defaults to a two-mile corridor", () => {
    const spec = buildTerrainCorridorSpec({ routeId: "r1", geometry: route });
    expect(spec.bufferMeters).toBe(DEFAULT_TERRAIN_CORRIDOR_METERS);
    expect(corridorCoverageLabel(spec)).toContain("2 mi corridor");
  });

  it("rejects an unbounded corridor", () => {
    expect(() => buildTerrainCorridorSpec({ routeId: "r1", geometry: route, bufferMeters: 20_000 })).toThrow(/10 miles/);
  });

  it("includes surrounding terrain layers instead of only the route", () => {
    const spec = buildTerrainCorridorSpec({ routeId: "r1", geometry: route });
    expect(spec.layers).toContain("roads");
    expect(spec.layers).toContain("water");
    expect(spec.layers).toContain("trails");
  });
});
