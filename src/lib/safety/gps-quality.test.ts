import { describe, expect, it } from "vitest";
import {
  formatFixAge,
  isDisplayableFix,
  isTrustedFix,
  isValidLatLng,
  sanitizeFixTimestamp,
  sanitizeStoredFixTimestamp,
  TRUSTED_FIX_MS,
  TRUSTED_STALE_FIX_MS,
} from "./gps-quality";

describe("gps quality", () => {
  const now = Date.parse("2026-08-19T21:00:00Z");

  it("trusts a live recent fix", () => {
    expect(isTrustedFix(now - 5_000, false, now)).toBe(true);
  });

  it("does not trust a last-known fix from a previous hike", () => {
    expect(isTrustedFix(now - 3 * 60 * 60 * 1000, true, now)).toBe(false);
  });

  it("does not trust a stale or last-known fix, even if recent", () => {
    expect(isTrustedFix(now - 45_000, true, now)).toBe(false);
    expect(isTrustedFix(now - TRUSTED_FIX_MS - 1, true, now)).toBe(false);
  });

  it("does not re-stamp a day-old timestamp as now", () => {
    const ancient = now - 48 * 60 * 60 * 1000;
    expect(sanitizeFixTimestamp(ancient, now)).toBe(ancient);
    expect(isTrustedFix(ancient, false, now)).toBe(false);
  });

  it("clamps a slightly-future GPS clock to now", () => {
    expect(sanitizeFixTimestamp(now + 60_000, now)).toBe(now);
  });

  it("hides last-known positions older than a day", () => {
    expect(isDisplayableFix(now - 2 * 60 * 60 * 1000, now)).toBe(true);
    expect(isDisplayableFix(now - 48 * 60 * 60 * 1000, now)).toBe(false);
  });

  it("formats fix age for rescue notes", () => {
    expect(formatFixAge(now - 8_000, now)).toBe("just now");
    expect(formatFixAge(now - 5 * 60_000, now)).toBe("5 min ago");
  });

  it("rejects impossible coordinates", () => {
    expect(isValidLatLng(37, -119)).toBe(true);
    expect(isValidLatLng(Number.NaN, -119)).toBe(false);
    expect(isValidLatLng(91, -119)).toBe(false);
    expect(isValidLatLng(0, 0)).toBe(false);
  });

  // Regression: `stale` was accepted and then ignored — the first line of isTrustedFix
  // could never change the result, so it read as a safety check while being a no-op.
  it("gives a held-over fix a shorter leash than a live one", () => {
    const age = (TRUSTED_FIX_MS + TRUSTED_STALE_FIX_MS) / 2;
    expect(isTrustedFix(now - age, false, now)).toBe(true);
    expect(isTrustedFix(now - age, true, now)).toBe(false);
  });

  // Regression: an ancient stored fix used to be stamped with Date.now(), promoting a
  // days-old position to a live one with no staleness marker.
  it("rejects a stored fix that is too old instead of making it look new", () => {
    expect(sanitizeStoredFixTimestamp(now - 3 * 86_400_000, now)).toBeNull();
    expect(sanitizeStoredFixTimestamp(now + 10 * 60_000, now)).toBeNull();
    expect(sanitizeStoredFixTimestamp(0, now)).toBeNull();
    expect(sanitizeStoredFixTimestamp(now - 60_000, now)).toBe(now - 60_000);
    expect(sanitizeStoredFixTimestamp((now - 60_000) / 1000, now)).toBe(now - 60_000);
  });

  it("sanitizes epoch, seconds, and future GPS timestamps", () => {
    expect(sanitizeFixTimestamp(0, now)).toBe(now);
    expect(sanitizeFixTimestamp(undefined, now)).toBe(now);
    expect(sanitizeFixTimestamp(now / 1000, now)).toBe(now);
    expect(sanitizeFixTimestamp(now + 10 * 60_000, now)).toBe(now);
    expect(sanitizeFixTimestamp(now - 8_000, now)).toBe(now - 8_000);
  });
});
