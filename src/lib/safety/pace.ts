/**
 * Walking-time estimates. Kept dependency-free so both the route readouts
 * (`field-ops`) and the daylight turnaround warning (`declination`) can share one
 * estimator — the two used to disagree, and the safety warning was the optimistic one.
 */

/**
 * Naismith + Langmuir-ish: 5 km/h + 1 h / 600 m climb + 10 min / 300 m steep descent.
 */
export function naismithMinutes(distanceM: number, gainM = 0, lossM = 0): number {
  // A distance that is not a number is not a zero-minute walk. Returning 0 here
  // printed "~0 min" and silenced the daylight warning on exactly the invalid
  // data that should have withdrawn the estimate.
  if (!Number.isFinite(distanceM)) return Number.NaN;
  if (!(distanceM > 0)) return 0;
  const walk = (distanceM / 5000) * 60;
  const climb = (Math.max(0, gainM) / 600) * 60;
  const drop = lossM >= 300 ? (lossM / 300) * 10 : 0;
  return Math.round(walk + climb + drop);
}

export function formatNaismith(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 7 * 24 * 60) {
    return "Naismith unavailable";
  }
  const rounded = Math.round(minutes);
  if (rounded === 0) return "Naismith ~0 min";
  if (rounded < 60) return `Naismith ~${rounded} min`;
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  return `Naismith ~${h} h ${m} min`;
}

/**
 * A pace actually measured on this walk, or null when there is not yet enough
 * travel to measure one honestly.
 *
 * The gates match `estimateGuardianEta` deliberately: the two numbers describe
 * the same hiker moving at the same speed, and it would be indefensible for the
 * family-facing ETA and the hiker-facing turnaround warning to disagree about
 * whether a pace is known.
 */
export interface ObservedPace {
  metersPerSecond: number;
  traveledMeters: number;
  elapsedMinutes: number;
}

export function observedPace(input: {
  nowMs: number;
  startedAtMs: number | null | undefined;
  traveledMeters: number | null | undefined;
}): ObservedPace | null {
  const { nowMs, startedAtMs, traveledMeters } = input;
  if (
    startedAtMs == null ||
    traveledMeters == null ||
    ![nowMs, startedAtMs, traveledMeters].every(Number.isFinite) ||
    startedAtMs > nowMs ||
    traveledMeters < 250
  ) {
    return null;
  }
  const elapsedSeconds = (nowMs - startedAtMs) / 1000;
  if (elapsedSeconds < 10 * 60) return null;
  const metersPerSecond = traveledMeters / elapsedSeconds;
  // Below 0.15 m/s this is a rest stop, not a pace; above 4.5 m/s it is a
  // vehicle or a GPS jump. Neither predicts the walk home.
  if (metersPerSecond < 0.15 || metersPerSecond > 4.5) return null;
  return { metersPerSecond, traveledMeters, elapsedMinutes: Math.round(elapsedSeconds / 60) };
}

/** Minutes for the distance ahead at a measured pace, keeping Naismith's allowance for the climb still to come. */
export function paceMinutes(distanceM: number, gainM: number, metersPerSecond: number): number {
  if (!Number.isFinite(distanceM)) return Number.NaN;
  if (!(distanceM > 0) || !(metersPerSecond > 0)) return 0;
  const walk = distanceM / metersPerSecond / 60;
  // The climb ahead is a specific obstacle the measured pace has no knowledge
  // of, so its allowance is kept. Where the ground already covered was steep the
  // measured pace is slow too and this double-counts a little — in the direction
  // of arriving early, which is the only direction a daylight warning may err.
  const climb = (Math.max(0, gainM) / 600) * 60;
  return Math.round(walk + climb);
}

export type EstimateBasis = "naismith" | "observed";

export interface WalkingEstimate {
  minutes: number;
  /** Which estimator produced the number, so the screen can say so instead of implying one authority. */
  basis: EstimateBasis;
}

/**
 * The walking estimate to act on: the slower of the book figure and the hiker's
 * own measured pace.
 *
 * Naismith's 5 km/h is a fit walker on a good path with a day pack. A party with
 * children, a heavy load, or snow underfoot moves at half of it, and until now
 * every turnaround warning in the app was computed as though they did not — the
 * app already measured their real speed and spent it only on the ETA it sends
 * the people at home. Taking the slower of the two means a fast party is never
 * given a shorter deadline than the book allows, and a slow one is finally
 * warned in time to turn around.
 */
export function walkingEstimate(
  distanceM: number,
  gainM: number,
  pace: ObservedPace | null,
): WalkingEstimate {
  const book = naismithMinutes(distanceM, gainM);
  if (!pace) return { minutes: book, basis: "naismith" };
  const measured = paceMinutes(distanceM, gainM, pace.metersPerSecond);
  return measured > book ? { minutes: measured, basis: "observed" } : { minutes: book, basis: "naismith" };
}

/** How to name the estimator on screen. Short enough for a HUD tile. */
export function estimateBasisLabel(basis: EstimateBasis): string {
  return basis === "observed" ? "your pace" : "Naismith";
}
