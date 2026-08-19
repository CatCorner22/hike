import { describe, expect, it } from "vitest";
import {
  compassLabel,
  isValidGeometry,
  normalizeHeading,
  progressAlongTrail,
  remainingElevationGain,
} from "./navigation";
import { daylightWarning, minutesUntilSunset } from "@/lib/safety/daylight";
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
});

describe("daylight warnings", () => {
  it("warns within an hour of sunset", () => {
    const lat = 37.77;
    const lng = -122.42;
    const sunset = new Date();
    sunset.setUTCHours(3, 0, 0, 0);
    const mins = minutesUntilSunset(sunset, lat, lng);
    const warning = daylightWarning(Math.min(mins, 45));
    expect(warning).toMatch(/sunset/i);
  });
});
