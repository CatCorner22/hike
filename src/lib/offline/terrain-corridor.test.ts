import { describe, expect, it } from "vitest";
import {
  buildTerrainCorridorSpec,
  corridorBboxAreaKm2,
  corridorCoverageLabel,
  corridorSizeLabel,
  DEFAULT_TERRAIN_CORRIDOR_METERS,
  describePersistedCorridor,
  estimateCorridorBytes,
  validTerrainCorridor,
} from "./terrain-corridor";

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

  it("estimates download size from bbox area and selected layers", () => {
    const full = buildTerrainCorridorSpec({ routeId: "r1", geometry: route });
    const hillshadeOnly = buildTerrainCorridorSpec({
      routeId: "r1",
      geometry: route,
      layers: ["hillshade"],
    });
    expect(estimateCorridorBytes(full)).toBeGreaterThan(estimateCorridorBytes(hillshadeOnly));
    expect(estimateCorridorBytes(full)).toBeGreaterThan(1024 * 1024);
    expect(corridorSizeLabel(full)).toMatch(/~\d+(\.\d+)? MB planned/);
    expect(describePersistedCorridor(full)).toContain("terrain tiles not downloaded yet");
  });

  it("scales the estimate with corridor bbox area", () => {
    const narrow = buildTerrainCorridorSpec({ routeId: "r1", geometry: route, bufferMeters: 800 });
    const wide = buildTerrainCorridorSpec({ routeId: "r1", geometry: route, bufferMeters: 3200 });
    expect(corridorBboxAreaKm2(wide.bbox)).toBeGreaterThan(corridorBboxAreaKm2(narrow.bbox) * 3);
    expect(estimateCorridorBytes(wide)).toBeGreaterThan(estimateCorridorBytes(narrow) * 3);
  });

  it("rejects a corridor that belongs to another route or carries unknown layers", () => {
    const spec = buildTerrainCorridorSpec({ routeId: "r1", geometry: route });
    expect(validTerrainCorridor(spec, "r1")).toBe(true);
    expect(validTerrainCorridor(spec, "other-route")).toBe(false);
    expect(validTerrainCorridor({ ...spec, layers: [...spec.layers, "secrets"] }, "r1")).toBe(false);
    expect(validTerrainCorridor({ ...spec, bufferMeters: 99_000 }, "r1")).toBe(false);
    expect(validTerrainCorridor({ ...spec, generatedAt: "not-a-date" }, "r1")).toBe(false);
  });
});
