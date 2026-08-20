import { describe, expect, it } from "vitest";
import {
  compassLabel,
  isValidGeometry,
  normalizeHeading,
  progressAlongTrail,
  remainingElevationGain,
} from "./navigation";
import { offTrailLevel, shouldRepeatAlert } from "@/lib/safety/alerts";

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
    expect(progress.offsetMeters).toBe(0);
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
