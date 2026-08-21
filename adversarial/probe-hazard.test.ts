import { describe, expect, it } from "vitest";
import {
  sampleRouteByDistance,
  summarizeHazards,
  type HazardObservation,
} from "@/lib/offline/route-hazard";

function hazard(severity: string): HazardObservation {
  return {
    sampleDistanceMeters: 0,
    kind: "weather",
    severity,
    title: "hazard",
    source: "feed",
  } as unknown as HazardObservation;
}

describe("route sampling stays on the route", () => {
  // Two 100 m components whose endpoints are ~157 km apart.
  const disconnected: GeoJSON.MultiLineString = {
    type: "MultiLineString",
    coordinates: [
      [
        [0, 0],
        [0.001, 0],
      ],
      [
        [1, 1],
        [1.001, 1],
      ],
    ],
  };

  it("does not invent samples in the gap between components", () => {
    // Flattening the components produced 32 samples strung along a straight
    // line across the gap, attaching hazards to places nobody walks through.
    const samples = sampleRouteByDistance(disconnected, 5000);
    expect(samples.length).toBeLessThanOrEqual(4);
    for (const sample of samples) {
      const onFirst = sample.lat === 0 && sample.lng >= 0 && sample.lng <= 0.001;
      const onSecond = sample.lat === 1 && sample.lng >= 1 && sample.lng <= 1.001;
      expect(onFirst || onSecond).toBe(true);
    }
  });

  it("reports walking distance, not the distance across the gap", () => {
    const samples = sampleRouteByDistance(disconnected, 5000);
    const furthest = Math.max(...samples.map((sample) => sample.distanceMeters));
    // ~222 m of actual walking, not ~157 km.
    expect(furthest).toBeLessThan(1000);
  });

  it("never emits a non-finite sample position", () => {
    const withNaN: GeoJSON.LineString = {
      type: "LineString",
      coordinates: [
        [0, 0],
        [Number.NaN, 0.5],
        [0.002, 0],
      ],
    };
    for (const sample of sampleRouteByDistance(withNaN, 100)) {
      expect(Number.isFinite(sample.lat)).toBe(true);
      expect(Number.isFinite(sample.lng)).toBe(true);
    }
  });

  it("does not throw on an unusable interval", () => {
    // This runs while building a pre-departure briefing; an exception there
    // takes out the whole panel.
    for (const interval of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => sampleRouteByDistance(disconnected, interval)).not.toThrow();
    }
  });

  it("returns nothing for geometry it cannot use", () => {
    expect(sampleRouteByDistance({ type: "LineString", coordinates: [[0, 0]] })).toEqual([]);
    expect(sampleRouteByDistance({ type: "LineString", coordinates: [] })).toEqual([]);
  });
});

describe("hazard summary never loses a hazard", () => {
  it("counts a severity it does not recognise instead of dropping it", () => {
    // `counts[severity] += 1` wrote a junk key, so these two critical hazards
    // summarised as highest: "none" -- reporting a clear route.
    const summary = summarizeHazards([hazard("Critical"), hazard("CRITICAL")]);
    expect(summary.unrecognised).toBe(2);
    expect(summary.highest).not.toBe("none");
  });

  it("escalates an unreadable severity to at least watch", () => {
    expect(summarizeHazards([hazard("bogus")]).highest).toBe("watch");
    expect(summarizeHazards([hazard(undefined as unknown as string)]).highest).toBe("watch");
  });

  it("does not leak junk keys into the summary", () => {
    const summary = summarizeHazards([hazard("Critical")]);
    expect(Object.keys(summary).sort()).toEqual(
      ["critical", "highest", "info", "unrecognised", "watch"].sort(),
    );
  });

  it("still summarises recognised severities correctly", () => {
    const summary = summarizeHazards([hazard("critical"), hazard("watch"), hazard("info")]);
    expect(summary).toMatchObject({ critical: 1, watch: 1, info: 1, unrecognised: 0, highest: "critical" });
    expect(summarizeHazards([]).highest).toBe("none");
  });
});
