import { describe, expect, it } from "vitest";
import {
  CORRIDOR_FEATURE_DISCLAIMER,
  corridorQueryAllowed,
  describeCorridorFeatures,
  MAX_CORRIDOR_QUERY_KM2,
  validCorridorFeatures,
} from "./corridor-features";
import { parseCorridorOverpassResponse } from "@/lib/osm/corridor-overpass";

const bbox: [number, number, number, number] = [-83.95, 35.93, -83.87, 36.01];

function sampleSet(routeId = "plan-1") {
  return parseCorridorOverpassResponse({
    routeId,
    bbox,
    elements: [
      {
        type: "way",
        id: 11,
        tags: { highway: "path", name: "Side trail" },
        geometry: [
          { lon: -83.94, lat: 35.94 },
          { lon: -83.93, lat: 35.95 },
        ],
      },
      {
        type: "node",
        id: 12,
        tags: { amenity: "shelter", name: "Hut" },
        lat: 35.96,
        lon: -83.92,
      },
    ],
  });
}

describe("corridor features", () => {
  it("accepts a parsed OSM snapshot for the matching route", () => {
    const set = sampleSet();
    expect(validCorridorFeatures(set, "plan-1", bbox)).toBe(true);
    expect(describeCorridorFeatures(set)).toContain("2 OSM features");
    expect(describeCorridorFeatures(set)).toContain(CORRIDOR_FEATURE_DISCLAIMER);
    expect(describeCorridorFeatures(set)).toContain("Terrain tiles are not downloaded");
  });

  it("rejects a foreign route, forged disclaimer, or unknown layer", () => {
    const set = sampleSet();
    expect(validCorridorFeatures(set, "other-route", bbox)).toBe(false);
    expect(validCorridorFeatures({ ...set, disclaimer: "all clear" }, "plan-1", bbox)).toBe(false);
    expect(validCorridorFeatures({
      ...set,
      features: {
        type: "FeatureCollection",
        features: [{
          type: "Feature",
          geometry: { type: "Point", coordinates: [-83.92, 35.96] },
          properties: { layer: "secrets" },
        }],
      },
      featureCount: 1,
      layersIncluded: ["secrets"],
    }, "plan-1", bbox)).toBe(false);
  });

  it("rejects a snapshot whose bbox is outside the corridor", () => {
    const set = sampleSet();
    expect(validCorridorFeatures(set, "plan-1", [-84.5, 35.0, -84.4, 35.1])).toBe(false);
  });

  it("refuses a bounding box too large for one Overpass snapshot", () => {
    expect(corridorQueryAllowed([-120, 30, -100, 50]).ok).toBe(false);
    expect(corridorQueryAllowed(bbox).ok).toBe(true);
    const refused = corridorQueryAllowed([-120, 30, -100, 50]);
    if (!refused.ok) expect(refused.reason).toMatch(/too large/);
    expect(MAX_CORRIDOR_QUERY_KM2).toBe(400);
  });
});
