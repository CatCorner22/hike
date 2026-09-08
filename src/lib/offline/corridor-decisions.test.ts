import { describe, expect, it } from "vitest";
import { CORRIDOR_DECISION_DISCLAIMER, deriveCorridorBailouts } from "./corridor-decisions";
import { parseCorridorOverpassResponse } from "@/lib/osm/corridor-overpass";

const geometry: GeoJSON.LineString = {
  type: "LineString",
  coordinates: [
    [-83.92, 35.96],
    [-83.90, 35.96],
  ],
};
const bbox: [number, number, number, number] = [-83.95, 35.93, -83.87, 36.01];

describe("corridor decisions", () => {
  it("keeps OSM features that meet the route and drops features that would require an invented walk", () => {
    const features = parseCorridorOverpassResponse({
      routeId: "plan-1",
      bboxes: [bbox],
      elements: [
        { type: "node", id: 1, tags: { amenity: "shelter", name: "Near hut" }, lat: 35.9602, lon: -83.91 },
        { type: "node", id: 2, tags: { amenity: "shelter", name: "Far hut" }, lat: 36.00, lon: -83.91 },
        {
          type: "way",
          id: 3,
          tags: { highway: "track", name: "Forest Rd" },
          geometry: [
            { lon: -83.905, lat: 35.9604 },
            { lon: -83.905, lat: 35.961 },
          ],
        },
        {
          type: "way",
          id: 4,
          tags: { highway: "track", name: "Distant Rd" },
          geometry: [
            { lon: -83.91, lat: 35.99 },
            { lon: -83.90, lat: 35.99 },
          ],
        },
        {
          type: "way",
          id: 5,
          tags: { waterway: "stream" },
          geometry: [
            { lon: -83.91, lat: 35.9601 },
            { lon: -83.91, lat: 35.961 },
          ],
        },
      ],
    });

    const candidates = deriveCorridorBailouts({
      geometry,
      features,
    });
    const names = candidates.map((candidate) => candidate.name);
    expect(names).toContain("Near hut");
    expect(names).toContain("Forest Rd");
    expect(names).not.toContain("Far hut");
    expect(names).not.toContain("Distant Rd");
    expect(candidates.some((candidate) => /stream|water/i.test(candidate.name))).toBe(false);
    expect(candidates[0]?.note).toContain(CORRIDOR_DECISION_DISCLAIMER);
  });

  it("returns nothing when the pack has no OSM snapshot", () => {
    expect(deriveCorridorBailouts({
      geometry,
      features: null,
    })).toEqual([]);
  });
});
