import { describe, expect, it } from "vitest";
import {
  compassLabel,
  isValidGeometry,
  normalizeHeading,
  progressAlongTrail,
  remainingElevationGain,
} from "./navigation";

const straightLine: GeoJSON.LineString = {
  type: "LineString",
  coordinates: [
    [-119.0, 37.0],
    [-119.0, 37.01],
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
