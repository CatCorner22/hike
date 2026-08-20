import { describe, expect, it } from "vitest";
import { sampleRouteByDistance, summarizeHazards } from "./route-hazard";

const route: GeoJSON.LineString = {
  type: "LineString",
  coordinates: [[-83.92, 35.96], [-83.91, 35.97], [-83.90, 35.98]],
};

describe("route hazard sampling", () => {
  it("samples by route distance and includes endpoints", () => {
    const points = sampleRouteByDistance(route, 1000);
    expect(points.length).toBeGreaterThanOrEqual(2);
    expect(points[0].distanceMeters).toBe(0);
    expect(points.at(-1)?.distanceMeters).toBeGreaterThan(0);
  });

  it("rejects invalid sampling intervals", () => {
    expect(() => sampleRouteByDistance(route, 0)).toThrow(/positive/);
  });

  it("summarizes the highest hazard without AI interpretation", () => {
    const summary = summarizeHazards([
      { sampleDistanceMeters: 1000, kind: "wind", severity: "watch", title: "High wind", source: "weather" },
      { sampleDistanceMeters: 3000, kind: "closure", severity: "critical", title: "Trail closed", source: "land manager" },
    ]);
    expect(summary.highest).toBe("critical");
    expect(summary.critical).toBe(1);
  });
});
