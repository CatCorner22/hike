import { describe, expect, it } from "vitest";
import { turnaroundWarning, magneticDeclination, formatWalkBearing } from "@/lib/safety/declination";
import { offTrailLevel } from "@/lib/safety/alerts";
import { isTrustedFix, formatFixAge } from "@/lib/safety/gps-quality";
import { observedPace, walkingEstimate } from "@/lib/safety/pace";
import { deadReckon, deadReckonUncertaintyM, distanceFromPaces } from "@/lib/safety/landnav";
import { formatUsng } from "@/lib/safety/usng";

const nasty = [Number.NaN, Infinity, -Infinity, -1, 0, 1e12];

describe("safety functions on hostile numbers", () => {
  it("off-trail level never invents a level from a bad offset", () => {
    for (const value of nasty) {
      expect(() => offTrailLevel(value)).not.toThrow();
    }
    expect(offTrailLevel(Number.NaN)).toBe("unknown");
  });

  it("turnaround warning stays silent rather than guessing", () => {
    for (const remaining of nasty) {
      for (const gain of nasty) {
        expect(() => turnaroundWarning(remaining, gain, 60, false)).not.toThrow();
      }
    }
  });

  it("declination and bearing formatting reject bad input", () => {
    for (const lat of nasty) {
      const declination = magneticDeclination(lat, 0);
      expect(declination === null || Number.isFinite(declination)).toBe(true);
    }
    for (const bearing of nasty) {
      expect(() => formatWalkBearing(bearing, 0)).not.toThrow();
    }
  });

  it("fix trust and age stay honest with broken timestamps", () => {
    for (const value of nasty) {
      expect(() => formatFixAge(value)).not.toThrow();
      expect(() => isTrustedFix(value, false)).not.toThrow();
    }
    expect(isTrustedFix(Number.NaN, false)).toBe(false);
    expect(isTrustedFix(Date.now(), true)).toBe(false);
  });

  it("withdraws the walking estimate instead of printing zero minutes", () => {
    expect(observedPace({ nowMs: Number.NaN, startedAtMs: 0, traveledMeters: 5_000 })).toBeNull();
    for (const distance of [Number.NaN, Infinity, -Infinity]) {
      const estimate = walkingEstimate(distance, 0, null);
      expect(Number.isFinite(estimate.minutes)).toBe(false);
      expect(turnaroundWarning(distance, 0, 30, false)).toBeNull();
    }
    // A real distance the party cannot finish before dark still warns.
    expect(turnaroundWarning(10_000, 0, 30, false)).toContain("Turn around");
  });

  it("dead reckoning refuses to place the hiker on bad input", () => {
    for (const value of nasty) {
      const point = deadReckon({ lat: 37, lng: -119 }, value, 100);
      if (point) {
        expect(Number.isFinite(point.lat)).toBe(true);
        expect(Number.isFinite(point.lng)).toBe(true);
      }
      expect(Number.isFinite(deadReckonUncertaintyM({ distanceM: value }))).toBe(true);
      expect(() => distanceFromPaces(value, 65, "flat")).not.toThrow();
    }
  });

  it("grid formatting never prints a partial coordinate", () => {
    for (const value of nasty) {
      const grid = formatUsng(value, 0);
      expect(grid === null || typeof grid === "string").toBe(true);
      if (typeof grid === "string") expect(grid).not.toMatch(/NaN|Infinity|undefined/);
    }
  });
});
