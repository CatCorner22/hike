/**
 * Elevation gain from noisy GPS altitudes.
 *
 * Phone GPS altitude jitters by metres between fixes. Summing every positive delta
 * therefore manufactures climb out of noise: measured with sigma = 5 m jitter, a
 * perfectly flat 5 km walk (500 accepted points) reported ~1,300 m of gain.
 *
 * The fix is the standard two-stage filter:
 *
 * 1. **Smooth** each sample with an exponential moving average, which shrinks
 *    uncorrelated jitter by ~sqrt of the effective window while following real terrain
 *    with only a small lag; then
 * 2. **Hysteresis** on the smoothed series — a climb or descent only counts once the
 *    smoothed altitude reverses by more than a threshold, so residual noise oscillating
 *    inside the band contributes nothing while every real ascent is banked valley-to-peak.
 *
 * With alpha = 0.25 the residual sigma of independent 5 m noise is ~1.9 m, putting the
 * 8 m threshold at ~4 sigma — false climbs become rare instead of constant.
 */
export const DEFAULT_GAIN_HYSTERESIS_M = 8;
export const DEFAULT_SMOOTHING_ALPHA = 0.25;

export interface GainTracker {
  /** Feed the next altitude sample; returns total gain so far (confirmed + in-progress climb). */
  add(altitudeM: number | null | undefined): number;
  /** Total gain so far, including a still-rising climb that has not reversed yet. */
  total(): number;
}

export function createGainTracker(
  hysteresisM = DEFAULT_GAIN_HYSTERESIS_M,
  smoothingAlpha = DEFAULT_SMOOTHING_ALPHA,
): GainTracker {
  let confirmed = 0;
  let smoothed: number | null = null;
  let state: "flat" | "up" | "down" = "flat";
  let anchor = 0; // last confirmed extreme (valley for an up-leg, peak for a down-leg)
  let extreme = 0; // running max (up) or min (down) of the current leg

  const inProgress = () => (state === "up" ? Math.max(0, extreme - anchor) : 0);

  return {
    add(altitudeM) {
      if (altitudeM == null || !Number.isFinite(altitudeM)) return confirmed + inProgress();

      if (smoothed == null) {
        smoothed = altitudeM;
        anchor = altitudeM;
        extreme = altitudeM;
        return confirmed;
      }
      smoothed = smoothed + smoothingAlpha * (altitudeM - smoothed);
      const value = smoothed;

      if (state === "flat") {
        // No direction yet: wait until the smoothed series leaves the noise band.
        if (value >= anchor + hysteresisM) {
          state = "up";
          extreme = value;
        } else if (value <= anchor - hysteresisM) {
          state = "down";
          extreme = value;
        } else if (value < anchor) {
          // Track downward drift so a later climb is measured from the true low.
          anchor = value;
        }
        return confirmed + inProgress();
      }

      if (state === "up") {
        if (value > extreme) extreme = value;
        if (value <= extreme - hysteresisM) {
          // Peak confirmed: bank the whole valley-to-peak climb.
          confirmed += extreme - anchor;
          state = "down";
          anchor = extreme;
          extreme = value;
        }
        return confirmed + inProgress();
      }

      // state === "down"
      if (value < extreme) extreme = value;
      if (value >= extreme + hysteresisM) {
        // Valley confirmed: the next climb is measured from here.
        state = "up";
        anchor = extreme;
        extreme = value;
      }
      return confirmed + inProgress();
    },
    total() {
      return confirmed + inProgress();
    },
  };
}

/** Convenience for a complete series, e.g. recomputing stored tracks. */
export function elevationGainWithHysteresis(
  altitudes: Array<number | null | undefined>,
  hysteresisM = DEFAULT_GAIN_HYSTERESIS_M,
): number {
  const tracker = createGainTracker(hysteresisM);
  for (const altitude of altitudes) tracker.add(altitude);
  return tracker.total();
}
