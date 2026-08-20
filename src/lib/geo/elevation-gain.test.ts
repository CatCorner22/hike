import { describe, expect, it } from "vitest";
import { createGainTracker, elevationGainWithHysteresis } from "./elevation-gain";

/** Deterministic Gaussian noise — no Math.random so failures reproduce exactly. */
function noiseSource(seedStart: number) {
  let seed = seedStart;
  const uniform = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  return (sigma: number) => {
    const u = Math.max(uniform(), 1e-9);
    const v = uniform();
    return sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

describe("elevation gain with hysteresis", () => {
  /**
   * Regression: the recorder summed every positive altitude delta, so ordinary GPS
   * jitter (sigma ~5 m) turned a perfectly flat 5 km walk into ~1,300 m of reported
   * climb — measured, not estimated. Gain must come from terrain, not noise.
   */
  it("reports (almost) no climb for a flat walk with realistic GPS noise", () => {
    for (const seed of [42, 7, 1999]) {
      const gauss = noiseSource(seed);
      const flat = Array.from({ length: 500 }, () => 1500 + gauss(5));

      let naive = 0;
      for (let index = 1; index < flat.length; index += 1) {
        const delta = flat[index] - flat[index - 1];
        if (delta > 0) naive += delta;
      }
      const withHysteresis = elevationGainWithHysteresis(flat);

      expect(naive, `seed ${seed}: the defect this guards against`).toBeGreaterThan(800);
      expect(withHysteresis, `seed ${seed}`).toBeLessThan(60);
    }
  });

  it("still measures a real climb, noise and all", () => {
    const gauss = noiseSource(11);
    // 600 m of genuine ascent over 400 points, with the same noise on top.
    const climb = Array.from({ length: 400 }, (_, index) => 1500 + index * 1.5 + gauss(5));
    const gain = elevationGainWithHysteresis(climb);
    expect(gain).toBeGreaterThan(540);
    expect(gain).toBeLessThan(680);
  });

  it("measures rolling terrain as the sum of its climbs, not its jitter", () => {
    const gauss = noiseSource(23);
    const points: number[] = [];
    // Three 100 m climbs separated by 100 m descents: true total gain 300 m.
    for (let leg = 0; leg < 3; leg += 1) {
      for (let step = 0; step < 50; step += 1) points.push(1500 + step * 2 + gauss(4));
      for (let step = 50; step >= 0; step -= 1) points.push(1500 + step * 2 + gauss(4));
    }
    const gain = elevationGainWithHysteresis(points);
    expect(gain).toBeGreaterThan(250);
    expect(gain).toBeLessThan(380);
  });

  it("ignores missing and non-finite altitudes without losing the climb", () => {
    const tracker = createGainTracker();
    tracker.add(1000);
    tracker.add(null);
    tracker.add(Number.NaN);
    tracker.add(undefined);
    // The smoothing filter needs a few samples to follow a step; the climb must still
    // be counted, and the invalid samples must not have reset or corrupted anything.
    for (let index = 0; index < 12; index += 1) tracker.add(1050);
    expect(tracker.total()).toBeGreaterThan(40);
    expect(tracker.total()).toBeLessThanOrEqual(50.5);
  });

  it("is incremental: streaming equals batch", () => {
    const gauss = noiseSource(5);
    const series = Array.from({ length: 300 }, (_, index) => 1200 + index * 0.7 + gauss(5));
    const tracker = createGainTracker();
    let streamed = 0;
    for (const altitude of series) streamed = tracker.add(altitude);
    expect(streamed).toBeCloseTo(elevationGainWithHysteresis(series), 6);
  });
});
