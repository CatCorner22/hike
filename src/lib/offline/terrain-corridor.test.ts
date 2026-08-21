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
    const area = (spec: typeof narrow) => spec.bboxes.reduce((total, bbox) => total + corridorBboxAreaKm2(bbox), 0);
    expect(area(wide)).toBeGreaterThan(area(narrow) * 3);
    expect(estimateCorridorBytes(wide)).toBeGreaterThan(estimateCorridorBytes(narrow) * 3);
  });

  it("splits a dateline corridor without dropping either side", () => {
    const dateline: GeoJSON.LineString = {
      type: "LineString",
      coordinates: [[179.9, 10], [-179.9, 10.1]],
    };
    const spec = buildTerrainCorridorSpec({ routeId: "dateline", geometry: dateline });
    expect(spec.bboxes).toHaveLength(2);
    expect(spec.bboxes.some(([minLng, , maxLng]) => minLng <= 179.9 && maxLng >= 179.9)).toBe(true);
    expect(spec.bboxes.some(([minLng, , maxLng]) => minLng <= -179.9 && maxLng >= -179.9)).toBe(true);
    expect(estimateCorridorBytes(spec)).toBeGreaterThan(0);
  });

  it("rejects a corridor that belongs to another route or carries unknown layers", () => {
    const spec = buildTerrainCorridorSpec({ routeId: "r1", geometry: route });
    expect(validTerrainCorridor(spec, "r1")).toBe(true);
    expect(validTerrainCorridor(spec, "other-route")).toBe(false);
    expect(validTerrainCorridor({ ...spec, layers: [...spec.layers, "secrets"] }, "r1")).toBe(false);
    expect(validTerrainCorridor({ ...spec, bufferMeters: 99_000 }, "r1")).toBe(false);
    expect(validTerrainCorridor({ ...spec, generatedAt: "not-a-date" }, "r1")).toBe(false);
    expect(validTerrainCorridor({ ...spec, bboxes: [[0, 0, 0, 0]] }, "r1", route)).toBe(false);
  });
});
