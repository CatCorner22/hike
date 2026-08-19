/** A live or briefly dropped GPS fix is trusted for off-trail alerts and follow-mode. */
export const TRUSTED_FIX_MS = 2 * 60 * 1000;

/** Older last-known positions may still be shown, but never as current location. */
export const DISPLAY_FIX_MS = 24 * 60 * 60 * 1000;

export function fixAgeMs(recordedAt: number, now = Date.now()): number {
  return Math.max(0, now - recordedAt);
}

export function isTrustedFix(recordedAt: number, stale: boolean, now = Date.now()): boolean {
  if (stale && fixAgeMs(recordedAt, now) > TRUSTED_FIX_MS) return false;
  return fixAgeMs(recordedAt, now) <= TRUSTED_FIX_MS;
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
