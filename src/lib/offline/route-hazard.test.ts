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

  it("falls back to the default interval instead of throwing", () => {
    // CHANGED DELIBERATELY. This test previously asserted that an invalid
    // interval throws. sampleRouteByDistance runs inside the pre-departure
    // panel's render, and the app has no error boundary, so that throw took the
    // whole plan page down -- including the offline-readiness controls next to
    // it. Sampling density is not a safety claim, so the safe failure here is to
    // fall back to the default interval and keep the panel on screen. The code
    // was changed and this assertion inverted; the alternative (keeping the
    // throw) would trade a cosmetic detail for the loss of the safety UI.
    for (const interval of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => sampleRouteByDistance(route, interval)).not.toThrow();
    }
    expect(sampleRouteByDistance(route, 0)).toEqual(sampleRouteByDistance(route, 5000));
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
