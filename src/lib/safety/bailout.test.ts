import { describe, expect, it } from "vitest";
import { bailoutDecisionPoints, rankBailouts, validateBailoutRoute } from "./bailout";

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

  it("accepts a plausible mapped bailout route", () => {
    const route: GeoJSON.LineString = { type: "LineString", coordinates: [[-83.9, 35.9], [-83.89, 35.91]] };
    expect(validateBailoutRoute(route)).toBeNull();
  });
});
