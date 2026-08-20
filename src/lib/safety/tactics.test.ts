import { describe, expect, it } from "vitest";
import {
  casevacDecision,
  lostPersonQuery,
  paceBeads,
  polarisHint,
  solarHour,
  watchMethodHeading,
} from "./tactics";
import { reconcileTriagePriority } from "./triage-priority";
import { gridConvergence } from "@/lib/safety/declination";

describe("tactics", () => {
  it("gives a northern watch-method hint", () => {
    const w = watchMethodHeading(15, "north");
    expect(w).not.toBeNull();
    expect(w!.toward).toBe("S");
    expect(w!.hint).toMatch(/south/i);
  });

  /**
   * Regression: the bisector must cross the SMALLER arc between the hour hand and the 12
   * mark. Before noon the hour hand is more than 180 deg clockwise of 12, so the smaller
   * arc is on the other side. Using `hourOn12 / 2` unconditionally pointed exactly
   * backwards for northern mornings, and its reflex did the same for southern afternoons
   * — 180 deg wrong, on the method you reach for when you have no compass.
   *
   * Checked against where the bisector actually points in true degrees, given the sun's
   * true azimuth at that solar hour.
   */
  it("points at the pole it claims, all day, in both hemispheres", () => {
    for (const hemisphere of ["north", "south"] as const) {
      for (const hour of [6.5, 8, 9, 10.5, 12, 13.5, 15, 16, 17.5]) {
        const { clockAzimuthFrom12, toward } = watchMethodHeading(hour, hemisphere);
        const hourOn12 = (hour % 12) * 30;

        // Sun azimuth (true, clockwise from north) at this solar hour.
        const sunAzimuth =
          hemisphere === "north"
            ? (180 + 15 * (hour - 12) + 360) % 360
            : (0 - 15 * (hour - 12) + 360) % 360;

        // Northern: the HOUR HAND is aimed at the sun. Southern: the 12 mark is.
        const twelveMarkTrue =
          hemisphere === "north" ? (sunAzimuth - hourOn12 + 720) % 360 : sunAzimuth;
        const bisectorTrue = (twelveMarkTrue + clockAzimuthFrom12) % 360;

        const expected = toward === "S" ? 180 : 0;
        const delta = Math.abs((((bisectorTrue - expected + 180) % 360) + 360) % 360 - 180);
        expect(delta, `${hemisphere} ${hour}h -> ${bisectorTrue.toFixed(0)}deg, wanted ${expected}`).toBeLessThan(1);
      }
    }
  });

  it("reads solar time from longitude, not the device clock", () => {
    // 18:00 UTC at 120 W is 10:00 solar, whatever the phone's zone or DST says.
    expect(solarHour(new Date("2026-08-20T18:00:00Z"), -120)).toBeCloseTo(10, 6);
    expect(solarHour(new Date("2026-08-20T18:00:00Z"), 0)).toBeCloseTo(18, 6);
    expect(solarHour(new Date("2026-08-20T02:00:00Z"), -120)).toBeCloseTo(18, 6);
  });

  it("uses Polaris at mid-latitudes", () => {
    expect(polarisHint(37)).toMatch(/37/);
    expect(polarisHint(-40)).toMatch(/Southern Cross/);
  });

  it("computes a small Sierra grid convergence", () => {
    const g = gridConvergence(37.7, -119.6);
    expect(g).not.toBeNull();
    expect(Math.abs(g!)).toBeLessThan(4);
  });

  it("keeps a non-walker in place", () => {
    expect(casevacDecision({ injured: true, canWalk: false, isDark: false }).choice).toBe("stay");
    expect(casevacDecision({ injured: false, canWalk: true, isDark: false, remainingM: 400, partySize: 2 }).choice).toBe(
      "walk-out",
    );
  });

  it("overrides generic stay-put advice for a time-critical medical evacuation", () => {
    const decision = casevacDecision({
      injured: true,
      canWalk: false,
      isDark: true,
      medicalOverride: "severe-altitude-illness",
    });
    expect(decision.choice).toBe("urgent-assisted-descent");
    expect(decision.reason).toMatch(/generic stay-put rule does not apply/i);
    expect(reconcileTriagePriority({
      altitude: { mustDescend: true, message: "DESCEND NOW" },
      movement: decision,
    })).toMatchObject({ action: "urgent-assisted-descent" });
  });

  it("counts pace beads in 9s", () => {
    expect(paceBeads(9).km).toBe(1);
    expect(paceBeads(10).beads).toBe(1);
    expect(paceBeads(Number.NaN).label).toMatch(/cannot determine/i);
    expect(watchMethodHeading(Number.POSITIVE_INFINITY, "north")).toBeNull();
    expect(polarisHint(91)).toBeNull();
    expect(gridConvergence(91, 0)).toBeNull();
  });

  it("builds a lost-person query", () => {
    const q = lostPersonQuery({ name: "Alex", clothing: "red jacket", lat: 37.1, lng: -119.2 });
    expect(q).toContain("Alex");
    expect(q).toContain("Your grid now");
  });
});
