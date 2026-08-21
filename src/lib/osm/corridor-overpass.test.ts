import { describe, expect, it } from "vitest";
import { buildCorridorOverpassQuery, parseCorridorOverpassResponse } from "./corridor-overpass";

const bbox: [number, number, number, number] = [-83.92, 35.96, -83.90, 35.98];

describe("corridor overpass", () => {
  it("queries Overpass using south,west,north,east and vector layers only", () => {
    const query = buildCorridorOverpassQuery([bbox]);
    expect(query).toContain("35.96000,-83.92000,35.98000,-83.90000");
    expect(query).toContain("highway");
    expect(query).toContain("waterway");
    expect(query).toContain("shelter");
    expect(query).not.toContain("hillshade");
    expect(query).not.toContain("contour");
  });

  it("queries both non-wrapping halves of a dateline corridor", () => {
    const query = buildCorridorOverpassQuery([
      [179.8, 10, 180, 10.2],
      [-180, 10, -179.8, 10.2],
    ]);
    expect(query).toContain("10.00000,179.80000,10.20000,180.00000");
    expect(query).toContain("10.00000,-180.00000,10.20000,-179.80000");
  });

  it("classifies ways and nodes and downsamples long lines", () => {
    const geometry = Array.from({ length: 120 }, (_, index) => ({
      lon: -83.92 + index * 0.0001,
      lat: 35.96,
    }));
    const set = parseCorridorOverpassResponse({
      routeId: "r1",
      bboxes: [bbox],
      elements: [
        { type: "way", id: 1, tags: { highway: "path" }, geometry },
        { type: "way", id: 2, tags: { highway: "track" }, geometry: geometry.slice(0, 3) },
        { type: "way", id: 3, tags: { waterway: "stream" }, geometry: geometry.slice(0, 3) },
        { type: "node", id: 4, tags: { tourism: "camp_site", name: "Camp\nforged" }, lat: 35.97, lon: -83.91 },
        { type: "node", id: 5, tags: { natural: "peak" }, lat: 35.97, lon: -83.91 },
        { type: "relation", id: 6, tags: { route: "hiking" } },
      ],
    });
    expect(set.featureCount).toBe(5);
    expect(set.layersIncluded).toEqual(["trails", "roads", "water", "campsites", "landmarks"]);
    const trail = set.features.features.find((feature) => feature.properties.layer === "trails");
    expect(trail?.geometry.type).toBe("LineString");
    if (trail?.geometry.type === "LineString") {
      expect(trail.geometry.coordinates.length).toBeLessThanOrEqual(48);
      expect(trail.geometry.coordinates.length).toBeGreaterThan(2);
    }
    const camp = set.features.features.find((feature) => feature.properties.layer === "campsites");
    expect(camp?.properties.name).toBe("Camp forged");
  });
});
