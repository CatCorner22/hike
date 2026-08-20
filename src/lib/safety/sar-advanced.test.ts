import { describe, expect, it } from "vitest";
import { litterEvacAdvice, litterEvacTime, MIN_LITTER_CARRIERS } from "./sar-advanced";

describe("litterEvacAdvice", () => {
  /**
   * Regression: the old rate table was keyed on party size with no floor, so a solo hiker
   * was told "Litter carry ~3.7 h for 3000 m" and a party of two "~2.3 h". A hand-carried
   * litter cannot be lifted by fewer than six, and a party that tries it drops the
   * casualty or exhausts itself into a second patient.
   */
  it("refuses to give a carry time to a party that cannot carry", () => {
    for (const partySize of [0, 1, 2, 3, 4, 5, 6, 7]) {
      const advice = litterEvacAdvice(3000, partySize);
      expect(advice.feasible, `party of ${partySize}`).toBe(false);
      expect(advice.hours).toBeNull();
      expect(advice.message).toMatch(/shelter in place|send for help/i);
      expect(advice.message).not.toMatch(/~\d+(\.\d+)?\s*(h|min) for/);
    }
  });

  it("does not count the casualty or their attendant as carriers", () => {
    expect(litterEvacAdvice(3000, 8).carriers).toBe(6);
    expect(litterEvacAdvice(3000, 2).carriers).toBe(0);
    expect(litterEvacAdvice(3000, 1).carriers).toBe(0);
  });

  it("gives a time once there are enough carriers", () => {
    const eight = litterEvacAdvice(3000, 8);
    expect(eight.feasible).toBe(true);
    expect(eight.carriers).toBeGreaterThanOrEqual(MIN_LITTER_CARRIERS);
    expect(eight.hours).toBeGreaterThan(0);
    expect(eight.message).toMatch(/Swap carriers/);
  });

  it("gets faster with more carriers, never slower", () => {
    let previous = Infinity;
    for (const partySize of [8, 10, 14, 20]) {
      const advice = litterEvacAdvice(5000, partySize);
      expect(advice.feasible).toBe(true);
      expect(advice.hours!, `party of ${partySize}`).toBeLessThanOrEqual(previous);
      previous = advice.hours!;
    }
  });

  it("stays conservative: never better than 1 mph even with a large team", () => {
    const advice = litterEvacAdvice(1609, 40);
    expect(advice.hours!).toBeGreaterThanOrEqual(1);
  });

  it("survives nonsense input", () => {
    expect(litterEvacAdvice(Number.NaN, Number.NaN).feasible).toBe(false);
    expect(litterEvacAdvice(-500, -3).feasible).toBe(false);
    expect(typeof litterEvacTime(3000, 2)).toBe("string");
  });
});
