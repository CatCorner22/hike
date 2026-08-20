/** A live GPS fix is trusted for off-trail alerts and follow-mode. */
export const TRUSTED_FIX_MS = 2 * 60 * 1000;

/** A briefly dropped fix stays usable, but not for as long as a live one. */
export const TRUSTED_STALE_FIX_MS = 60 * 1000;

/** Older last-known positions may still be shown, but never as current location. */
export const DISPLAY_FIX_MS = 24 * 60 * 60 * 1000;

export function isValidLatLng(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function normaliseEpoch(timestamp: number | undefined | null): number | null {
  if (timestamp == null || !Number.isFinite(timestamp) || timestamp <= 0) return null;
  // 10-digit values are seconds; 13-digit values are milliseconds.
  return timestamp < 1e11 ? timestamp * 1000 : timestamp;
}

/**
 * Normalise the timestamp on a **live** position reading. Phone GPS timestamps are
 * sometimes 0, seconds-since-epoch, or clock-skewed; a reading that just arrived from
 * `watchPosition` is current by definition, so an implausible value becomes `now`.
 *
 * Never call this on a stored or replayed fix — stamping it `now` would promote an old
 * position to a live one with no staleness marker. Use `sanitizeStoredFixTimestamp`.
 */
export function sanitizeFixTimestamp(
  timestamp: number | undefined | null,
  now = Date.now(),
): number {
  const t = normaliseEpoch(timestamp);
  if (t == null) return now;
  if (t > now + 120_000) return now;
  if (now - t > DISPLAY_FIX_MS) return now;
  return t;
}

/**
 * Normalise the timestamp on a fix read back from storage. Unlike a live reading there
 * is no ground truth to fall back on, so anything implausible is rejected rather than
 * being made to look recent.
 */
export function sanitizeStoredFixTimestamp(
  timestamp: number | undefined | null,
  now = Date.now(),
): number | null {
  const t = normaliseEpoch(timestamp);
  if (t == null) return null;
  if (t > now + 120_000) return null;
  if (now - t > DISPLAY_FIX_MS) return null;
  return t;
}

export function fixAgeMs(recordedAt: number, now = Date.now()): number {
  return Math.max(0, now - recordedAt);
}

/**
 * A live fix is trusted for `TRUSTED_FIX_MS`. A fix the GPS layer has already flagged
 * as held-over is not being confirmed by the receiver, so it gets the shorter leash —
 * previously `stale` was accepted and then ignored, which read as a check but was not one.
 */
export function isTrustedFix(recordedAt: number, stale: boolean, now = Date.now()): boolean {
  const limit = stale ? TRUSTED_STALE_FIX_MS : TRUSTED_FIX_MS;
  return fixAgeMs(recordedAt, now) <= limit;
}

export function isDisplayableFix(recordedAt: number, now = Date.now()): boolean {
  return fixAgeMs(recordedAt, now) <= DISPLAY_FIX_MS;
}

export function formatFixAge(recordedAt: number, now = Date.now()): string {
  const age = fixAgeMs(recordedAt, now);
  if (age < 15_000) return "just now";
  if (age < 60_000) return `${Math.round(age / 1000)}s ago`;
  if (age < 3_600_000) return `${Math.round(age / 60_000)} min ago`;
  if (age < 86_400_000) return `${Math.round(age / 3_600_000)} h ago`;
  return `${Math.round(age / 86_400_000)} d ago`;
}
