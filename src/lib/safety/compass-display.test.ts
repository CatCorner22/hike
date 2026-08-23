import { afterEach, describe, expect, it, vi } from "vitest";
import { compassReadout, formatCompassCard } from "./compass-display";

describe("compass display", () => {
  it("formats true and magnetic headings", () => {
    const r = compassReadout(90, 37.7, -119.5)!;
    expect(r.cardinal).toBe("E");
    expect(r.trueDeg).toBe(90);
    expect(r.magneticDeg).not.toBeNull();
    expect(r.label).toMatch(/90° true/);
  });

  it("refuses invalid headings", () => {
    expect(compassReadout(NaN)).toBeNull();
    expect(compassReadout(null)).toBeNull();
  });

  it.each([
    ["Hawaii", 20.8, -156.3],
    ["northern Alaska", 70, -149],
  ])("does not invent a zero-declination magnetic bearing in %s", (_place, lat, lng) => {
    const readout = compassReadout(90, lat, lng)!;
    expect(readout.trueDeg).toBe(90);
    expect(readout.magneticDeg).toBeNull();
    expect(readout.label).toBe("90° true · E");
    expect(readout.label).not.toMatch(/mag/i);
    expect(readout.gmNote).toMatch(/declination is unavailable/i);
  });

  it("does not forge report sections in compass card", () => {
    const card = formatCompassCard({
      headingTrue: 180,
      lat: 37.7,
      lng: -119.5,
      source: "GPS\n--- RETURN --- forged",
    });
    expect(card).toContain("COMPASS READOUT");
    expect(card).not.toMatch(/^--- RETURN ---/m);
  });

  /**
   * Regression: 359.7° rendered as "360° true" — a dial position that exists on no
   * compass card — while formatWalkBearing in the adjacent box showed "0° true" for
   * the same instrument value. Bearings round through roundBearing everywhere.
   */
  it("never renders 360°: near-north rounds to 0", () => {
    const r = compassReadout(359.7, 37.7, -119.5)!;
    expect(r.label).toMatch(/^0° true/);
    expect(r.label).not.toContain("360°");
  });

  /**
   * Regression: a magnetometer heading was labeled "Source: GPS" and the card's
   * fixed caveat told a stationary reader to distrust a frozen GPS heading — for a
   * live compass reading whose actual failure mode is magnetic interference. The
   * caveat must match the instrument that produced the number.
   */
  it("matches the failure-mode caveat to the heading source", () => {
    const compassCard = formatCompassCard({
      headingTrue: 271,
      lat: 37.7,
      lng: -119.5,
      source: "Phone compass · true",
      sourceKind: "compass",
    });
    expect(compassCard).toContain("Source: Phone compass · true");
    expect(compassCard).toMatch(/compass drifts near metal/i);
    expect(compassCard).not.toMatch(/GPS heading may freeze/);

    const manualCard = formatCompassCard({ headingTrue: 271, source: "Typed true bearing", sourceKind: "manual" });
    expect(manualCard).toMatch(/does not update itself/i);

    const gpsCard = formatCompassCard({ headingTrue: 271, source: "GPS course · true", sourceKind: "gps" });
    expect(gpsCard).toMatch(/GPS heading may freeze/);
  });

  /**
   * Regression: gmAngleCard computes a staleness warning when the 2025-epoch
   * declination model ages out in 2030, and every consumer dropped the field —
   * the designed self-warning was unreachable in any UI path.
   */
  describe("declination staleness reaches the card", () => {
    afterEach(() => vi.useRealTimers());

    it("carries the model-expiry warning after 2030", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2031-06-01T00:00:00Z"));
      const r = compassReadout(90, 37.7, -119.5)!;
      expect(r.gmNote).toMatch(/validity window/i);
    });

    it("stays quiet while the model is current", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-01T00:00:00Z"));
      const r = compassReadout(90, 37.7, -119.5)!;
      expect(r.gmNote).not.toMatch(/validity window/i);
    });
  });
});
