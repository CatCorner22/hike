import { describe, expect, it } from "vitest";
import {
  corridorBboxDegreesExceeded,
  corridorQuery,
  parseCorridorResponse,
  MAX_CORRIDOR_QUERY_DEGREES,
} from "@/lib/osm/corridor-query";
import type { OverpassResponse } from "@/lib/osm/overpass";

describe("corridorQuery", () => {
  it("emits Overpass south,west,north,east ordering", () => {
    // The axis order between GeoJSON bboxes and Overpass is a standing trap in
    // this codebase: swapping them silently queries the wrong hemisphere rather
    // than failing.
    const query = corridorQuery([-119.6, 37.7, -119.4, 37.85]);
    expect(query).toContain("37.70000,-119.60000,37.85000,-119.40000");
  });

  it("declares a server-side timeout and size ceiling", () => {
    const query = corridorQuery([-1, -1, 1, 1]);
    expect(query).toMatch(/\[timeout:\d+\]/);
    expect(query).toMatch(/\[maxsize:\d+\]/);
  });

  it("asks for roads, water and shelter", () => {
    const query = corridorQuery([-1, -1, 1, 1]);
    for (const expected of ["highway", "waterway", "amenity", "tourism"]) {
      expect(query).toContain(expected);
    }
  });

  it("does not request generic buildings", () => {
    // Measured against Yosemite Valley, a plain building clause was 1,193 of
    // 1,881 features and 43% of the payload, and would crowd roads and water out
    // of the storage caps. Shelters, huts and campsites are requested by tag
    // instead, as both nodes and ways.
    const query = corridorQuery([-1, -1, 1, 1]);
    expect(query).not.toMatch(/way\["building"\]/);
    expect(query).toContain('way["amenity"="shelter"]');
    expect(query).toMatch(/way\["tourism"~.*alpine_hut/);
  });
});

describe("corridorBboxDegreesExceeded", () => {
  it("refuses an area large enough to be an accident", () => {
    expect(corridorBboxDegreesExceeded([0, 0, MAX_CORRIDOR_QUERY_DEGREES + 0.1, 0.1])).toBe(true);
    expect(corridorBboxDegreesExceeded([0, 0, 0.1, MAX_CORRIDOR_QUERY_DEGREES + 0.1])).toBe(true);
  });

  it("allows a normal route corridor", () => {
    expect(corridorBboxDegreesExceeded([-119.6, 37.7, -119.4, 37.85])).toBe(false);
  });
});

describe("parseCorridorResponse", () => {
  it("classifies ways by escape value", () => {
    const response = {
      elements: [
        { type: "way", id: 1, tags: { highway: "secondary", name: "Hwy 120" }, geometry: [{ lat: 37.7, lon: -119.5 }, { lat: 37.71, lon: -119.49 }] },
        { type: "way", id: 2, tags: { highway: "track" }, geometry: [{ lat: 37.7, lon: -119.5 }, { lat: 37.71, lon: -119.49 }] },
        { type: "way", id: 3, tags: { highway: "path" }, geometry: [{ lat: 37.7, lon: -119.5 }, { lat: 37.71, lon: -119.49 }] },
        { type: "way", id: 4, tags: { waterway: "stream" }, geometry: [{ lat: 37.7, lon: -119.5 }, { lat: 37.71, lon: -119.49 }] },
      ],
    } as unknown as OverpassResponse;
    const { lines } = parseCorridorResponse(response);
    expect(lines.map((line) => line.kind)).toEqual(["road", "track", "trail", "water"]);
    expect(lines[0].name).toBe("Hwy 120");
  });

  it("classifies nodes a hiker can use", () => {
    const response = {
      elements: [
        { type: "node", id: 1, lat: 37.7, lon: -119.5, tags: { amenity: "shelter" } },
        { type: "node", id: 2, lat: 37.7, lon: -119.5, tags: { tourism: "wilderness_hut" } },
        { type: "node", id: 3, lat: 37.7, lon: -119.5, tags: { tourism: "camp_site" } },
        { type: "node", id: 4, lat: 37.7, lon: -119.5, tags: { amenity: "drinking_water" } },
        { type: "node", id: 5, lat: 37.7, lon: -119.5, tags: { natural: "spring" } },
      ],
    } as unknown as OverpassResponse;
    const { points } = parseCorridorResponse(response);
    expect(points.map((point) => point.kind)).toEqual(["shelter", "shelter", "campsite", "water", "water"]);
  });

  it("reduces a building footprint to one point", () => {
    // The footprint is not navigational detail, but "a structure is here" is
    // exactly what matters after dark.
    const response = {
      elements: [
        {
          type: "way",
          id: 9,
          tags: { building: "yes" },
          geometry: [
            { lat: 37.7, lon: -119.5 },
            { lat: 37.7, lon: -119.4 },
            { lat: 37.8, lon: -119.4 },
            { lat: 37.8, lon: -119.5 },
          ],
        },
      ],
    } as unknown as OverpassResponse;
    const { lines, points } = parseCorridorResponse(response);
    expect(lines).toHaveLength(0);
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ kind: "building" });
    expect(points[0].lat).toBeCloseTo(37.75, 5);
  });

  it("skips elements with unusable geometry instead of interpolating", () => {
    // Overpass omits nodes outside the query area rather than nulling them, so a
    // gap is expected and must not be bridged with a straight line.
    const response = {
      elements: [
        { type: "way", id: 1, tags: { highway: "primary" }, geometry: [{ lat: 37.7, lon: -119.5 }] },
        { type: "way", id: 2, tags: { highway: "primary" }, geometry: [{ lat: Number.NaN, lon: -119.5 }, { lat: 37.7, lon: -119.5 }] },
        { type: "way", id: 3, tags: { highway: "primary" } },
        { type: "node", id: 4, tags: { amenity: "shelter" } },
      ],
    } as unknown as OverpassResponse;
    const { lines, points } = parseCorridorResponse(response);
    expect(lines).toHaveLength(0);
    expect(points).toHaveLength(0);
  });

  it("returns empty for missing, null or malformed responses without throwing", () => {
    for (const bad of [null, undefined, {}, { elements: null }, { elements: "x" }]) {
      const result = parseCorridorResponse(bad as unknown as OverpassResponse);
      expect(result.lines).toEqual([]);
      expect(result.points).toEqual([]);
    }
  });

  it("ignores untagged and irrelevant elements", () => {
    const response = {
      elements: [
        { type: "way", id: 1, geometry: [{ lat: 37.7, lon: -119.5 }, { lat: 37.71, lon: -119.49 }] },
        { type: "relation", id: 2, tags: { highway: "primary" } },
        null,
        "garbage",
      ],
    } as unknown as OverpassResponse;
    const result = parseCorridorResponse(response);
    expect(result.lines).toEqual([]);
    expect(result.points).toEqual([]);
  });
});
