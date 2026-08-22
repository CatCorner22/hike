import { describe, expect, it } from "vitest";
import { bailoutDecisionPoints, explicitBailoutCandidates, rankBailouts, validateBailoutRoute } from "./bailout";

const candidates = [
  { id: "road", name: "Forest Road", kind: "road" as const, lat: 35.9, lng: -83.9, routeDistanceMeters: 5000, exitDistanceMeters: 900 },
  { id: "shelter", name: "Shelter", kind: "shelter" as const, lat: 35.91, lng: -83.91, routeDistanceMeters: 4200, exitDistanceMeters: 300 },
];

describe("bailout planning", () => {
  it("prefers the shorter derived exit among nearby future candidates", () => {
    expect(rankBailouts({ candidates, distanceTravelledMeters: 3000 })[0].id).toBe("shelter");
  });

  it("converts candidates to decision points without inventing geometry", () => {
    const points = bailoutDecisionPoints(candidates);
    expect(points[0].id).toBe("shelter");
    expect(points[0].note).toContain("300 m");
  });

  it("only treats explicitly named Bailout or Exit waypoints as user candidates", () => {
    const geometry: GeoJSON.LineString = { type: "LineString", coordinates: [[-83.9, 35.9], [-83.89, 35.91]] };
    const found = explicitBailoutCandidates([
      { name: "Bailout: Forest road", lat: 35.9003, lng: -83.899 },
      { name: "Pretty view", lat: 35.9003, lng: -83.899 },
    ], geometry);
    expect(found).toHaveLength(1);
    expect(found[0].name).toBe("Forest road");
    expect(found[0].note).toMatch(/User-marked/);
  });

  it("accepts an explicitly typed bailout without a magic name prefix", () => {
    const geometry: GeoJSON.LineString = {
      type: "LineString",
      coordinates: [[0, 0], [0.01, 0]],
    };
    const candidates = explicitBailoutCandidates(
      [{ name: "Road 8", kind: "bailout", lat: 0, lng: 0.005 }],
      geometry,
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].name).toBe("Road 8");
    expect(candidates[0].note).toMatch(/Verify the actual mapped path/);
  });

  it("accepts a plausible mapped bailout route", () => {
    const route: GeoJSON.LineString = { type: "LineString", coordinates: [[-83.9, 35.9], [-83.89, 35.91]] };
    expect(validateBailoutRoute(route)).toBeNull();
  });
});
