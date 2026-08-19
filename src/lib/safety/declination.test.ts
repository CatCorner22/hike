import { describe, expect, it } from "vitest";
import {
  formatWalkBearing,
  isFixNearRouteBbox,
  magneticDeclination,
  toMagneticBearing,
  turnaroundWarning,
} from "./declination";

describe("magneticDeclination", () => {
  it("is east of true north in the Sierra", () => {
    const d = magneticDeclination(37.7, -119.6);
    expect(d).not.toBeNull();
    expect(d!).toBeGreaterThan(8);
    expect(d!).toBeLessThan(18);
  });

  it("is west of true north in New England", () => {
    const d = magneticDeclination(42.4, -71.1);
    expect(d).not.toBeNull();
    expect(d!).toBeLessThan(-8);
  });

  it("converts true bearings to magnetic for a compass", () => {
    expect(toMagneticBearing(40, 13)).toBe(27);
    expect(formatWalkBearing(40, 37.7, -119.6)).toMatch(/true/);
    expect(formatWalkBearing(40, 37.7, -119.6)).toMatch(/magnetic/);
  });
});

describe("turnaroundWarning", () => {
  it("warns when remaining time exceeds daylight", () => {
    const warning = turnaroundWarning(8000, 20, false);
    expect(warning).toMatch(/Turn around/);
  });

  it("stays quiet when there is enough daylight", () => {
    expect(turnaroundWarning(1000, 90, false)).toBeNull();
    expect(turnaroundWarning(8000, 20, true)).toBeNull();
  });
});

describe("isFixNearRouteBbox", () => {
  const yosemite: [number, number, number, number] = [-119.7, 37.6, -119.4, 37.8];

  it("accepts a fix on the trail", () => {
    expect(isFixNearRouteBbox(37.7, -119.55, yosemite)).toBe(true);
  });

  it("rejects a last-known fix from another region", () => {
    expect(isFixNearRouteBbox(37.77, -122.42, yosemite)).toBe(false);
  });
});
