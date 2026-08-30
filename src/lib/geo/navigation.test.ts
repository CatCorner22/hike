import { describe, expect, it } from "vitest";
import {
  compassLabel,
  gpsAccuracyLabel,
  isValidGeometry,
  normalizeHeading,
  progressAlongTrail,
  safeBbox,
  trailLengthMeters,
  travelDirectionAlong,
  type TravelDirection,
  remainingElevationGain,
} from "./navigation";
import { offTrailLevel, shouldRepeatAlert } from "@/lib/safety/alerts";
import { MAX_ROUTE_PACK_COORDINATES } from "@/lib/offline/route-pack";

const straightLine: GeoJSON.LineString = {
  type: "LineString",
  coordinates: [
    [-119.0, 37.0],
    [-119.0, 37.01],
  ],
};

const multiLine: GeoJSON.MultiLineString = {
  type: "MultiLineString",
  coordinates: [
    [
      [-119.0, 37.0],
      [-119.0, 37.005],
    ],
    [
      [-119.0, 37.005],
      [-119.0, 37.01],
    ],
  ],
};

describe("progressAlongTrail", () => {
  it("reports near-zero offset when the user is on the line", () => {
    const progress = progressAlongTrail({ lat: 37.005, lng: -119.0 }, straightLine);
    expect(progress.offsetMeters).toBeLessThan(5);
    expect(progress.traveledMeters).toBeGreaterThan(progress.totalMeters * 0.4);
    expect(progress.traveledMeters).toBeLessThan(progress.totalMeters * 0.6);
    expect(progress.remainingMeters + progress.traveledMeters).toBeCloseTo(
      progress.totalMeters,
      0,
    );
  });

  it("detects a meaningful off-trail offset", () => {
    const progress = progressAlongTrail({ lat: 37.005, lng: -119.002 }, straightLine);
    expect(progress.offsetMeters).toBeGreaterThan(50);
  });

  it("treats the start as zero traveled distance", () => {
    const progress = progressAlongTrail({ lat: 37.0, lng: -119.0 }, straightLine);
    expect(progress.traveledMeters).toBeLessThan(20);
  });

  it("picks the closest segment on MultiLineString geometry", () => {
    const onSecond = progressAlongTrail({ lat: 37.0075, lng: -119.0 }, multiLine);
    expect(onSecond.offsetMeters).toBeLessThan(5);
    expect(onSecond.traveledMeters).toBeGreaterThan(multiLine.coordinates[0].length);
  });

  it("remaining on a disconnected MultiLineString uses the active component only", () => {
    const disconnected: GeoJSON.MultiLineString = {
      type: "MultiLineString",
      coordinates: [
        [[0, 0], [0, 0.01]],
        [[1, 1], [1, 0.99]],
      ],
    };
    const nearEndSecond = progressAlongTrail({ lat: 0.991, lng: 1 }, disconnected, [], "forward");
    const secondLength = trailLengthMeters({
      type: "LineString",
      coordinates: disconnected.coordinates[1],
    });
    expect(nearEndSecond.remainingMeters).toBeLessThan(secondLength * 0.15);
    expect(nearEndSecond.remainingMeters).toBeLessThan(500);
  });

  it("keeps remaining-m at the finish of a loop instead of snapping to the start", () => {
    const loop: GeoJSON.LineString = {
      type: "LineString",
      coordinates: [
        [-119.0, 37.0],
        [-119.0, 37.004],
        [-118.996, 37.004],
        [-118.996, 37.0],
        [-119.0, 37.0],
      ],
    };
    const nearEnd = progressAlongTrail({ lat: 37.0002, lng: -119.001 }, loop);
    expect(nearEnd.totalMeters).toBeGreaterThan(200);
    const kept = progressAlongTrail(
      { lat: 37.0002, lng: -119.001 },
      loop,
      [],
      { traveledMeters: nearEnd.totalMeters - 40 },
    );
    expect(kept.remainingMeters).toBe(0);
    expect(kept.traveledMeters).toBe(kept.totalMeters);
  });

  it("still measures the usable component when another one is corrupt", () => {
    const partlyCorrupt = {
      type: "MultiLineString",
      coordinates: [
        [[-119.0, 37.0], [-119.0, 37.01]],
        [[Number.NaN, 37.02], [-119.0, 37.03]],
      ],
    } as unknown as GeoJSON.MultiLineString;
    const progress = progressAlongTrail({ lat: 37.005, lng: -119.0 }, partlyCorrupt);
    expect(progress.totalMeters).toBeGreaterThan(1_000);
    expect(Number.isFinite(progress.traveledMeters)).toBe(true);
    expect(Number.isFinite(progress.remainingMeters)).toBe(true);
  });
});

describe("safeBbox", () => {
  it("bounds a route at the offline pack coordinate limit without overflowing the stack", () => {
    const geometry: GeoJSON.LineString = {
      type: "LineString",
      coordinates: Array.from({ length: MAX_ROUTE_PACK_COORDINATES }, (_, index) => [
        -119 + index * 1e-6,
        37 + index * 1e-6,
      ]),
    };
    const nested = (depth: number): [number, number, number, number] | null =>
      depth === 0 ? safeBbox(geometry, { lat: 37.5, lng: -119.5 }) : nested(depth - 1);
    const bbox = nested(2_000);
    expect(bbox).not.toBeNull();
    expect(bbox![1]).toBeCloseTo(37 - 0.004, 6);
    expect(bbox![3]).toBeCloseTo(37.5 + 0.004, 6);
  });
});

describe("remainingElevationGain", () => {
  it("counts only climb after the current location", () => {
    const gain = remainingElevationGain(
      [
        { distanceMeters: 0, elevation: 100 },
        { distanceMeters: 500, elevation: 200 },
        { distanceMeters: 1000, elevation: 180 },
        { distanceMeters: 1500, elevation: 260 },
      ],
      500,
    );
    expect(gain).toBeCloseTo(80, 0);
  });
});

describe("heading helpers", () => {
  it("normalizes negative headings", () => {
    expect(normalizeHeading(-90)).toBe(270);
  });

  it("labels cardinal directions", () => {
    expect(compassLabel(0)).toBe("N");
    expect(compassLabel(90)).toBe("E");
  });
});

describe("isValidGeometry", () => {
  it("rejects empty or invalid geometry", () => {
    expect(isValidGeometry(null)).toBe(false);
    expect(isValidGeometry({ type: "LineString", coordinates: [] })).toBe(false);
    expect(isValidGeometry(straightLine)).toBe(true);
  });

  it("rejects NaN or out-of-range coordinates that would crash Turf", () => {
    expect(
      isValidGeometry({
        type: "LineString",
        coordinates: [
          [-119, 37],
          [Number.NaN, 37],
        ],
      }),
    ).toBe(false);
    expect(
      isValidGeometry({
        type: "MultiLineString",
        coordinates: [
          [
            [999, 37],
            [1000, 38],
          ],
        ],
      }),
    ).toBe(false);
  });
});

describe("progressAlongTrail empty geometry", () => {
  it("does not throw on a MultiLineString with only stub segments", () => {
    const empty: GeoJSON.MultiLineString = {
      type: "MultiLineString",
      coordinates: [[[-119, 37]], []],
    };
    const progress = progressAlongTrail({ lat: 37, lng: -119 }, empty);
    expect(progress.traveledMeters).toBe(0);
    expect(Number.isFinite(progress.offsetMeters)).toBe(false);
  });
});

describe("safety alerts", () => {
  it("escalates off-trail severity with distance", () => {
    expect(offTrailLevel(10)).toBe("ok");
    expect(offTrailLevel(50)).toBe("warn");
    expect(offTrailLevel(120)).toBe("critical");
  });

  it("debounces repeated vibration alerts", () => {
    expect(shouldRepeatAlert(null, "warn")).toBe(true);
    expect(shouldRepeatAlert(Date.now() - 1000, "warn")).toBe(false);
    expect(shouldRepeatAlert(Date.now() - 40_000, "critical")).toBe(true);
  });

  it("does not raise off-trail alerts from an untrusted last-known fix", () => {
    expect(offTrailLevel(200, 8, { trustedFix: false })).toBe("unknown");
  });

  it("still warns when raw offset is large even if GPS accuracy is poor", () => {
    expect(offTrailLevel(120, 80)).toBe("warn");
  });
});

describe("bearingToTrail", () => {
  const line: GeoJSON.LineString = {
    type: "LineString",
    coordinates: [
      [-119.6, 37.75],
      [-119.5, 37.75],
    ],
  };

  // Regression: this came straight from turf.bearing (-180..180) and was rendered raw,
  // so the OFF TRAIL banner could tell a hiker to "Walk -122° true".
  it("is always a compass heading, never negative", () => {
    for (let lat = 37.72; lat <= 37.78; lat += 0.005) {
      for (let lng = -119.66; lng <= -119.44; lng += 0.02) {
        const { bearingToTrail } = progressAlongTrail({ lat, lng }, line);
        expect(bearingToTrail, `${lat},${lng}`).toBeGreaterThanOrEqual(0);
        expect(bearingToTrail, `${lat},${lng}`).toBeLessThan(360);
      }
    }
  });

  it("points north from south of the line and south from north of it", () => {
    expect(progressAlongTrail({ lat: 37.74, lng: -119.55 }, line).bearingToTrail).toBeCloseTo(0, 0);
    expect(progressAlongTrail({ lat: 37.76, lng: -119.55 }, line).bearingToTrail).toBeCloseTo(180, 0);
  });
});

describe("direction of travel along the route", () => {
  // A 5.3 km west-east line. stitchRelationWays normalises every OSM chain to run
  // west->east, so a hiker who parked at the EAST trailhead walks against the stored
  // direction — which is roughly half of all traversals.
  const line: GeoJSON.LineString = {
    type: "LineString",
    coordinates: [
      [-119.56, 37.75],
      [-119.54, 37.75],
      [-119.52, 37.75],
      [-119.5, 37.75],
    ],
  };
  const at = (lng: number) => ({ lat: 37.75, lng });
  const total = trailLengthMeters(line);

  /**
   * Regression: `remaining` was always `total - traveled`. Walking east->west it read
   * 0.00 km at the trailhead and counted UP to 5.28 km at the destination — and fed
   * turnaroundWarning, so the daylight warning stayed silent at the start of a long walk.
   */
  it("counts down, not up, when walking against the stored direction", () => {
    const west = [-119.5, -119.52, -119.54, -119.56];
    let previous = Infinity;
    for (const lng of west) {
      const p = progressAlongTrail(at(lng), line, [], "backward");
      expect(p.remainingMeters, `at ${lng}`).toBeLessThan(previous);
      previous = p.remainingMeters;
    }
    expect(progressAlongTrail(at(-119.5), line, [], "backward").remainingMeters).toBeCloseTo(total, 0);
    expect(progressAlongTrail(at(-119.56), line, [], "backward").remainingMeters).toBeCloseTo(0, 0);
  });

  it("still counts down when walking with the stored direction", () => {
    let previous = Infinity;
    for (const lng of [-119.56, -119.54, -119.52, -119.5]) {
      const p = progressAlongTrail(at(lng), line, [], "forward");
      expect(p.remainingMeters, `at ${lng}`).toBeLessThan(previous);
      previous = p.remainingMeters;
    }
  });

  it("reports the nearer end, and says so, before direction is established", () => {
    const nearWest = progressAlongTrail(at(-119.555), line, [], "unknown");
    expect(nearWest.remainingDirection).toBe("unknown");
    expect(nearWest.remainingMeters).toBeLessThan(total / 2);

    const nearEast = progressAlongTrail(at(-119.505), line, [], "unknown");
    expect(nearEast.remainingMeters).toBeLessThan(total / 2);
  });

  it("infers direction from the breadcrumb track", () => {
    expect(travelDirectionAlong(line, [at(-119.56), at(-119.53)])).toBe("forward");
    expect(travelDirectionAlong(line, [at(-119.5), at(-119.53)])).toBe("backward");
  });

  /**
   * Regression (Codex review of 6cf303f, P1): direction was taken from the session's
   * FIRST breadcrumb, so on an out-and-back — the most common hike shape — it kept
   * answering "forward" for the whole return leg. Remaining then counted to the far end
   * the hiker had just left and INCREASED as they walked home, and turnaroundWarning
   * judged the wrong distance against the remaining daylight.
   */
  it("flips direction after a turnaround on an out-and-back", () => {
    // Walk west->east to the far end, turn around, walk back.
    const out = [-119.56, -119.55, -119.54, -119.53, -119.52, -119.51, -119.5].map(at);
    expect(travelDirectionAlong(line, out)).toBe("forward");

    // Now returning: append the inbound leg one fix at a time.
    const back = [-119.51, -119.52, -119.53, -119.54, -119.55].map(at);
    const returning = [...out];
    const seen: TravelDirection[] = [];
    for (const step of back) {
      returning.push(step);
      seen.push(travelDirectionAlong(line, returning));
    }
    // It must not still be claiming "forward" once well into the return leg.
    expect(seen[seen.length - 1]).toBe("backward");
    expect(seen).not.toContain("forward");
  });

  it("keeps Remaining decreasing across a turnaround", () => {
    const out = [-119.56, -119.55, -119.54, -119.53, -119.52, -119.51, -119.5].map(at);
    const back = [-119.51, -119.52, -119.53, -119.54, -119.55].map(at);
    const track = [...out];
    let previous = Infinity;
    for (const step of back) {
      track.push(step);
      const direction = travelDirectionAlong(line, track);
      const progress = progressAlongTrail(step, line, [], direction);
      expect(progress.remainingMeters, `returning at ${step.lng}`).toBeLessThan(previous);
      previous = progress.remainingMeters;
    }
  });

  it("says unknown rather than guessing from GPS jitter or a standstill", () => {
    expect(travelDirectionAlong(line, [at(-119.53), at(-119.5301)])).toBe("unknown");
    expect(travelDirectionAlong(line, [at(-119.53)])).toBe("unknown");
    expect(travelDirectionAlong(line, [])).toBe("unknown");
    expect(travelDirectionAlong(line, [{ lat: Number.NaN, lng: 0 }, at(-119.5)])).toBe("unknown");
  });

  it("counts the climb that is actually ahead of you", () => {
    // Uphill west->east: 100 m at the west end, 700 m at the east end.
    const profile = [
      { distanceMeters: 0, elevation: 100 },
      { distanceMeters: total / 2, elevation: 400 },
      { distanceMeters: total, elevation: 700 },
    ];
    const middle = at(-119.53);
    const forward = progressAlongTrail(middle, line, profile, "forward");
    const backward = progressAlongTrail(middle, line, profile, "backward");
    // Heading east is uphill; heading west from the same point is all descent.
    expect(forward.remainingElevationMeters).toBeGreaterThan(200);
    expect(backward.remainingElevationMeters).toBeCloseTo(0, 0);
  });
});

describe("gpsAccuracyLabel", () => {
  /**
   * Regression: the HUD printed "GPS ±0 m (good)" — the most confident thing
   * the app can say — for the one accuracy value that carries no confidence at
   * all. A screenshot caught it rendering four rows under an orange banner that
   * had just declared the same fix untrusted.
   */
  it("treats a non-positive accuracy as unknown, not as perfect", () => {
    expect(gpsAccuracyLabel(0)).toBe("GPS accuracy unknown");
    expect(gpsAccuracyLabel(-1)).toBe("GPS accuracy unknown");
    expect(gpsAccuracyLabel(null)).toBe("GPS accuracy unknown");
    expect(gpsAccuracyLabel(Number.NaN)).toBe("GPS accuracy unknown");
    expect(gpsAccuracyLabel(20_000)).toBe("GPS accuracy unknown");
  });

  it("still grades a real measurement", () => {
    expect(gpsAccuracyLabel(4)).toBe("GPS ±4 m (good)");
    expect(gpsAccuracyLabel(15)).toBe("GPS ±15 m (fair)");
    expect(gpsAccuracyLabel(60)).toBe("GPS ±60 m (poor — canyon/trees)");
  });
});
