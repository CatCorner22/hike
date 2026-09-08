import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GUARDIAN_MAX_ETA_HOURS,
  GUARDIAN_MAX_SHARE_HOURS,
  GUARDIAN_SHARE_MARGIN_HOURS,
  estimateGuardianEta,
} from "./status";

const share = readFileSync(
  resolve(process.cwd(), "src/components/safety/guardian-share.tsx"),
  "utf8",
);

/**
 * The create button was disabled whenever the return time fell past the link's
 * expiry, under the message "Choose a longer link" — and with a 72 h ceiling and
 * a 72 h maximum choice, every trip longer than three days hit a button that
 * could never be enabled and an instruction nobody could follow.
 */
describe("a share link can be created for a trip of any length", () => {
  it("has a ceiling that covers more than a long weekend", () => {
    expect(GUARDIAN_MAX_SHARE_HOURS).toBeGreaterThanOrEqual(7 * 24);
  });

  it("never disables the create button on the chosen duration", () => {
    expect(share).toMatch(/disabled=\{!linkConsent \|\| linkBusy\}/);
    expect(share).not.toMatch(/disabled=\{[^}]*expiresBeforeReturn/);
  });

  it("offers a duration that covers the return time, with a margin for running late", () => {
    expect(GUARDIAN_SHARE_MARGIN_HOURS).toBeGreaterThan(0);
    expect(share).toMatch(/Through my return time/);
    expect(share).toMatch(/GUARDIAN_SHARE_MARGIN_HOURS/);
  });

  it("says plainly what to do when even the ceiling cannot cover the trip", () => {
    expect(share).toMatch(/returnBeyondCeiling/);
    expect(share).toMatch(/longer than any link lives/);
  });

  it("always prints the moment the link stops updating", () => {
    expect(share).toMatch(/Stops updating \{new Date\(linkExpiresAt\)\.toLocaleString\(\)\}/);
  });
});

/**
 * The link ceiling and the ETA sanity bound were one constant. They are two
 * different claims: a link may reasonably cover a two-week expedition, while an
 * ETA projected two weeks out from an hour of walking is arithmetic on noise.
 */
describe("the ETA bound did not move with the link ceiling", () => {
  it("keeps rejecting an ETA projected absurdly far ahead", () => {
    expect(GUARDIAN_MAX_ETA_HOURS).toBe(72);
    const now = Date.parse("2026-08-20T12:00:00Z");
    // 0.3 m/s measured over two hours, with 400 km still to go: ~370 h away.
    expect(
      estimateGuardianEta({
        nowMs: now,
        startedAtMs: now - 2 * 3_600_000,
        traveledMeters: 2160,
        remainingMeters: 400_000,
      }),
    ).toBeNull();
  });

  it("still returns an ETA inside the bound", () => {
    const now = Date.parse("2026-08-20T12:00:00Z");
    expect(
      estimateGuardianEta({
        nowMs: now,
        startedAtMs: now - 2 * 3_600_000,
        traveledMeters: 7200,
        remainingMeters: 3600,
      }),
    ).toBe(new Date(now + 3600 * 1000).toISOString());
  });
});
