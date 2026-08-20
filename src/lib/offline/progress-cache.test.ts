import { describe, expect, it } from "vitest";
import { progressAlongTrail } from "@/lib/geo/navigation";
import { buildRoutePack } from "@/lib/offline/route-pack";
import { createRouteProgressCache, progressWithRouteCache } from "./progress-cache";

// A 5.3 km west-east line, stored the way stitchRelationWays normalises OSM chains.
const GEOMETRY: GeoJSON.LineString = {
  type: "LineString",
  coordinates: [
    [-119.56, 37.75],
    [-119.54, 37.75],
    [-119.52, 37.75],
    [-119.5, 37.75],
  ],
};

const PROFILE = [
  { distanceMeters: 0, elevation: 100 },
  { distanceMeters: 2640, elevation: 400 },
  { distanceMeters: 5280, elevation: 700 },
];

function pack() {
  return buildRoutePack({
    id: "trail-test",
    name: "Cache parity",
    geometry: GEOMETRY,
    elevationProfile: PROFILE,
  });
}

const at = (lng: number) => ({ lat: 37.75, lng });

describe("progressWithRouteCache — direction parity with progressAlongTrail", () => {
  /**
   * Regression: this cache re-derived remaining as "total - traveled" on its own, which
   * silently re-introduced the backwards "Remaining" readout the direction-aware
   * progressAlongTrail had just fixed — 0.00 km at the trailhead, counting up to 5.28 km
   * at the destination for anyone walking against the stored line direction. Both paths
   * must resolve remaining through the same helper, and this test pins them together.
   */
  it("agrees with the reference path in every direction, everywhere on the route", () => {
    for (const direction of ["forward", "backward", "unknown"] as const) {
      const cache = createRouteProgressCache(pack());
      for (const lng of [-119.56, -119.5495, -119.53, -119.5105, -119.5]) {
        const reference = progressAlongTrail(at(lng), GEOMETRY, PROFILE, direction);
        const cached = progressWithRouteCache(cache, at(lng), direction);
        expect(cached.remainingMeters, `${direction} at ${lng}`).toBeCloseTo(
          reference.remainingMeters,
          0,
        );
        expect(cached.remainingElevationMeters, `${direction} climb at ${lng}`).toBeCloseTo(
          reference.remainingElevationMeters,
          0,
        );
        expect(cached.remainingDirection).toBe(reference.remainingDirection);
      }
    }
  });

  it("counts down toward the destination when walking against the stored direction", () => {
    const cache = createRouteProgressCache(pack());
    let previous = Infinity;
    for (const lng of [-119.5, -119.52, -119.54, -119.56]) {
      const progress = progressWithRouteCache(cache, at(lng), "backward");
      expect(progress.remainingMeters, `at ${lng}`).toBeLessThan(previous);
      previous = progress.remainingMeters;
    }
    expect(previous).toBeCloseTo(0, 0);
  });

  it("sums the climb that is ahead, not behind", () => {
    const cache = createRouteProgressCache(pack());
    const middle = at(-119.53);
    // Uphill west->east: heading east climbs; heading west from the midpoint is descent.
    expect(progressWithRouteCache(cache, middle, "forward").remainingElevationMeters).toBeGreaterThan(200);
    expect(progressWithRouteCache(cache, middle, "backward").remainingElevationMeters).toBeCloseTo(0, 0);
  });
});
