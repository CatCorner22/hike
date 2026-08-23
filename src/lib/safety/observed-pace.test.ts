import { describe, expect, it } from "vitest";
import { naismithMinutes, observedPace, paceMinutes, walkingEstimate } from "./pace";
import { turnaroundWarning } from "./declination";
import { estimateGuardianEta } from "@/lib/guardian/status";

const MINUTE = 60_000;
const NOW = Date.parse("2026-08-20T18:00:00Z");

/** Two hours of walking at 2 km/h — a scout troop, or anyone carrying a pack uphill. */
const SLOW = observedPace({ nowMs: NOW, startedAtMs: NOW - 120 * MINUTE, traveledMeters: 4000 });

describe("a pace the app has actually measured", () => {
  it("refuses to call a few metres of jitter a pace", () => {
    expect(observedPace({ nowMs: NOW, startedAtMs: NOW - 120 * MINUTE, traveledMeters: 200 })).toBeNull();
    expect(observedPace({ nowMs: NOW, startedAtMs: NOW - 5 * MINUTE, traveledMeters: 900 })).toBeNull();
  });

  it("refuses a speed that is a rest stop or a vehicle", () => {
    // 10 min at rest: 250 m over two hours is 0.03 m/s.
    expect(observedPace({ nowMs: NOW, startedAtMs: NOW - 120 * MINUTE, traveledMeters: 260 })).toBeNull();
    // 60 km/h is a road, not a trail.
    expect(observedPace({ nowMs: NOW, startedAtMs: NOW - 60 * MINUTE, traveledMeters: 60_000 })).toBeNull();
  });

  it("refuses a start time in the future or a corrupt input", () => {
    expect(observedPace({ nowMs: NOW, startedAtMs: NOW + MINUTE, traveledMeters: 4000 })).toBeNull();
    expect(observedPace({ nowMs: NOW, startedAtMs: null, traveledMeters: 4000 })).toBeNull();
    expect(observedPace({ nowMs: Number.NaN, startedAtMs: NOW - 120 * MINUTE, traveledMeters: 4000 })).toBeNull();
    expect(observedPace({ nowMs: NOW, startedAtMs: NOW - 120 * MINUTE, traveledMeters: null })).toBeNull();
  });

  it("measures 2 km/h as 2 km/h", () => {
    expect(SLOW).not.toBeNull();
    expect(SLOW!.metersPerSecond).toBeCloseTo(4000 / (120 * 60), 5);
    expect(SLOW!.elapsedMinutes).toBe(120);
  });

  /**
   * The family-facing ETA and the hiker-facing turnaround warning describe the
   * same person walking at the same speed. If one of them thinks a pace is
   * measurable and the other does not, one of the two is lying to somebody.
   */
  it("agrees with the guardian ETA about when a pace exists at all", () => {
    for (const [elapsedMin, traveled] of [
      [120, 4000],
      [5, 900],
      [120, 200],
      [60, 60_000],
    ] as const) {
      const args = { nowMs: NOW, startedAtMs: NOW - elapsedMin * MINUTE, traveledMeters: traveled };
      const havePace = observedPace(args) !== null;
      const haveEta = estimateGuardianEta({ ...args, remainingMeters: 3000 }) !== null;
      expect(havePace).toBe(haveEta);
    }
  });
});

/**
 * Naismith's 5 km/h describes a fit walker on a good path. The app measured the
 * real speed of the party the whole time and spent it only on the ETA it sent
 * home — so a troop moving at 2 km/h was told it had two hours of walking left
 * when it had five, and turned around far too late.
 */
describe("the walking estimate takes the slower of the book and the party", () => {
  it("uses the measured pace when the party is slower than the book", () => {
    const estimate = walkingEstimate(6000, 0, SLOW);
    expect(estimate.basis).toBe("observed");
    expect(estimate.minutes).toBe(paceMinutes(6000, 0, SLOW!.metersPerSecond));
    expect(estimate.minutes).toBeGreaterThan(naismithMinutes(6000, 0));
  });

  it("never gives a fast party a shorter deadline than the book allows", () => {
    const fast = observedPace({ nowMs: NOW, startedAtMs: NOW - 60 * MINUTE, traveledMeters: 8000 });
    expect(fast).not.toBeNull();
    const estimate = walkingEstimate(6000, 0, fast);
    expect(estimate.basis).toBe("naismith");
    expect(estimate.minutes).toBe(naismithMinutes(6000, 0));
  });

  it("falls back to the book when no pace has been measured", () => {
    expect(walkingEstimate(6000, 200, null)).toEqual({ minutes: naismithMinutes(6000, 200), basis: "naismith" });
  });

  it("keeps the climb allowance for ground not yet walked", () => {
    expect(paceMinutes(0, 500, 1)).toBe(0);
    expect(paceMinutes(3600, 600, 1)).toBe(60 + 60);
  });
});

describe("the turnaround warning is judged at the party's real pace", () => {
  it("warns a slow party that a fast estimate would have waved through", () => {
    // 6 km flat, 100 min of daylight. Naismith says 72 min: no warning.
    expect(turnaroundWarning(6000, 0, 100, false)).toBeNull();
    // At the measured 2 km/h it is three hours of walking, and the sun beats them.
    const warned = turnaroundWarning(6000, 0, 100, false, SLOW);
    expect(warned).toMatch(/Turn around or finish with a headlamp/);
    expect(warned).toMatch(/at your pace/);
  });

  it("says which estimator produced the number", () => {
    const book = turnaroundWarning(20_000, 0, 30, false);
    expect(book).toMatch(/at Naismith/);
    expect(book).not.toMatch(/at your pace/);
  });

  it("stays silent in the dark and at the end of the route", () => {
    expect(turnaroundWarning(6000, 0, 100, true, SLOW)).toBeNull();
    expect(turnaroundWarning(0, 0, 10, false, SLOW)).toBeNull();
  });
});
