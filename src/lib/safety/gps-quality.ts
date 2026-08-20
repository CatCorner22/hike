/** A live GPS fix is trusted for off-trail alerts and follow-mode. */
export const TRUSTED_FIX_MS = 2 * 60 * 1000;

/** A briefly dropped fix stays usable, but not for as long as a live one. */
export const TRUSTED_STALE_FIX_MS = 60 * 1000;

/** Older last-known positions may still be shown, but never as current location. */
export const DISPLAY_FIX_MS = 24 * 60 * 60 * 1000;

let lastTimestampDiagnostic: "future-clamped" | "invalid-replaced" | null = null;
export function getFixTimestampDiagnostic() { return lastTimestampDiagnostic; }

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
 * Phone GPS timestamps are sometimes 0, seconds-since-epoch, or clock-skewed.
 * Ancient times must keep their age (never become “now”). Future skew is clamped.
 *
 * Never call this on a stored or replayed fix — stamping an implausible live
 * reading `now` is only safe because `watchPosition` just delivered it.
 * Use `sanitizeStoredFixTimestamp` for IDB / last-known positions.
 */
export function sanitizeFixTimestamp(
  timestamp: number | undefined | null,
  now = Date.now(),
): number {
  const t = normaliseEpoch(timestamp);
  if (t == null) { lastTimestampDiagnostic = "invalid-replaced"; return now; }
  if (t > now) { lastTimestampDiagnostic = "future-clamped"; return now; }
  lastTimestampDiagnostic = null;
  return t;
}

/**
 * Normalise the timestamp on a fix read back from storage. Unlike a live reading there
 * is no ground truth to fall back on, so anything implausible is rejected rather than
 * being made to look recent. Display-only — never trusted as a live fix.
 */
export function sanitizeStoredFixTimestamp(
  timestamp: number | undefined | null,
  now = Date.now(),
): number | null {
  const t = normaliseEpoch(timestamp);
  if (t == null || t > now || now - t > DISPLAY_FIX_MS) return null;
  return t;
}

export function fixAgeMs(recordedAt: number, now = Date.now()): number {
  return Math.max(0, now - recordedAt);
}

/** Stale / last-known / storage-hydrated fixes are display-only — never trusted. */
export function isTrustedFix(recordedAt: number, stale: boolean, now = Date.now()): boolean {
  if (!Number.isFinite(recordedAt) || !Number.isFinite(now) || recordedAt > now) return false;
  if (stale) return false;
  return fixAgeMs(recordedAt, now) <= TRUSTED_FIX_MS;
}

export function isDisplayableFix(recordedAt: number, now = Date.now()): boolean {
  return fixAgeMs(recordedAt, now) <= DISPLAY_FIX_MS;
}

export function formatFixAge(recordedAt: number, now = Date.now()): string {
  if (!Number.isFinite(recordedAt) || !Number.isFinite(now)) return "time unavailable";
  const age = fixAgeMs(recordedAt, now);
  if (age < 15_000) return "just now";
  if (age < 60_000) return `${Math.round(age / 1000)}s ago`;
  if (age < 3_600_000) return `${Math.round(age / 60_000)} min ago`;
  if (age < 86_400_000) return `${Math.round(age / 3_600_000)} h ago`;
  return `${Math.round(age / 86_400_000)} d ago`;
}
