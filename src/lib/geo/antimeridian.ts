/** Longitude helpers for the half-open WGS84 domain [-180, 180). */
export interface LongitudeInterval {
  /** Linear, unwrapped western edge. May be greater than 180 for a wrapped view. */
  minLng: number;
  /** Linear, unwrapped eastern edge. Always >= minLng. */
  maxLng: number;
  /** True when the compact interval crosses the antimeridian. */
  wrapsAntimeridian: boolean;
}

export function normalizeLongitude(lng: number): number | null {
  if (!Number.isFinite(lng)) return null;
  return ((lng + 180) % 360 + 360) % 360 - 180;
}

/**
 * Returns the shortest circular interval containing every supplied longitude.
 * The returned interval is deliberately unwrapped for linear renderers: a
 * dateline route can be [179.9, 180.1], not a world-spanning [-179.9, 179.9].
 */
export function minimumLongitudeInterval(longitudes: readonly number[]): LongitudeInterval | null {
  const normalized = longitudes
    .map(normalizeLongitude)
    .filter((lng): lng is number => lng != null)
    .sort((a, b) => a - b);
  if (normalized.length !== longitudes.length || normalized.length === 0) return null;
  if (normalized.length === 1) {
    return { minLng: normalized[0], maxLng: normalized[0], wrapsAntimeridian: false };
  }

  let largestGap = -1;
  let gapAfter = 0;
  for (let index = 0; index < normalized.length; index++) {
    const next = index === normalized.length - 1 ? normalized[0] + 360 : normalized[index + 1];
    const gap = next - normalized[index];
    if (gap > largestGap) {
      largestGap = gap;
      gapAfter = index;
    }
  }

  const minLng = normalized[(gapAfter + 1) % normalized.length];
  const end = normalized[gapAfter];
  const maxLng = end < minLng ? end + 360 : end;
  return {
    minLng,
    maxLng,
    wrapsAntimeridian: maxLng > 180,
  };
}

/** Converts a longitude to the unwrapped domain used by an interval. */
export function unwrapLongitude(lng: number, interval: Pick<LongitudeInterval, "minLng" | "maxLng">): number | null {
  const normalized = normalizeLongitude(lng);
  if (normalized == null || !Number.isFinite(interval.minLng) || !Number.isFinite(interval.maxLng)) return null;
  const candidates = [normalized - 360, normalized, normalized + 360];
  const center = (interval.minLng + interval.maxLng) / 2;
  return candidates.reduce((best, candidate) =>
    Math.abs(candidate - center) < Math.abs(best - center) ? candidate : best,
  );
}

/** Tests membership against either ordinary or unwrapped wrapped intervals. */
export function isLongitudeInInterval(
  lng: number,
  interval: Pick<LongitudeInterval, "minLng" | "maxLng">,
  padding = 0,
): boolean {
  if (
    !Number.isFinite(interval.minLng) ||
    !Number.isFinite(interval.maxLng) ||
    !Number.isFinite(padding) ||
    padding < 0
  ) return false;
  const unwrapped = unwrapLongitude(lng, interval);
  return unwrapped != null &&
    unwrapped >= interval.minLng - padding &&
    unwrapped <= interval.maxLng + padding;
}
