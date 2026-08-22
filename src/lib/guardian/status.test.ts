import { describe, expect, it } from "vitest";
import {
  classifyGuardianStatus,
  estimateGuardianEta,
  guardianProgressPercent,
  guardianTokenHash,
  GUARDIAN_TOKEN_PATTERN,
  newGuardianToken,
} from "./status";

describe("Guardian status truthfulness", () => {
  const now = new Date("2026-08-22T16:00:00Z");

  it("distinguishes recent, cached and unknown server updates", () => {
    expect(classifyGuardianStatus({ now, lastUpdateAt: "2026-08-22T15:58:00Z" })).toMatchObject({
      dataState: "live",
      displayState: "live",
    });
    expect(classifyGuardianStatus({ now, lastUpdateAt: "2026-08-22T15:40:00Z" })).toMatchObject({
      dataState: "cached",
      displayState: "cached",
    });
    expect(classifyGuardianStatus({ now, lastUpdateAt: null })).toMatchObject({
      dataState: "unknown",
      displayState: "unknown",
    });
  });

  it("calls a passed deadline overdue without claiming distress", () => {
    const state = classifyGuardianStatus({
      now,
      lastUpdateAt: "2026-08-22T15:59:00Z",
      overdueAt: "2026-08-22T15:30:00Z",
    });
    expect(state).toEqual({
      dataState: "live",
      deadlineState: "overdue",
      displayState: "overdue",
    });
    expect(JSON.stringify(state).toLowerCase()).not.toContain("distress");
  });

  it("never calls a future-dated update live", () => {
    expect(classifyGuardianStatus({
      now,
      lastUpdateAt: "2026-08-22T16:05:00Z",
    }).dataState).toBe("unknown");
  });
});

describe("Guardian token privacy", () => {
  it("creates a 256-bit URL-fragment-safe token and stores a digest", async () => {
    const token = newGuardianToken();
    expect(token).toMatch(GUARDIAN_TOKEN_PATTERN);
    const digest = await guardianTokenHash(token);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).not.toContain(token);
    expect(await guardianTokenHash(token)).toBe(digest);
  });

  it("refuses malformed bearer tokens before hashing", async () => {
    await expect(guardianTokenHash("too-short")).rejects.toThrow(/malformed/i);
  });
});

describe("Guardian route fields", () => {
  it("reports bounded progress and keeps unknown inputs unknown", () => {
    expect(guardianProgressPercent(2500, 7500)).toBe(25);
    expect(guardianProgressPercent(undefined, 7500)).toBeNull();
    expect(guardianProgressPercent(-1, 100)).toBeNull();
    expect(guardianProgressPercent(0, 0)).toBeNull();
  });

  it("does not invent an ETA from a short or implausible sample", () => {
    const nowMs = Date.parse("2026-08-22T16:00:00Z");
    expect(estimateGuardianEta({
      nowMs,
      startedAtMs: nowMs - 5 * 60_000,
      traveledMeters: 500,
      remainingMeters: 1000,
    })).toBeNull();
    expect(estimateGuardianEta({
      nowMs,
      startedAtMs: nowMs - 60 * 60_000,
      traveledMeters: 100,
      remainingMeters: 1000,
    })).toBeNull();
  });

  it("uses an observed ten-minute-plus pace for ETA", () => {
    const nowMs = Date.parse("2026-08-22T16:00:00Z");
    expect(estimateGuardianEta({
      nowMs,
      startedAtMs: nowMs - 30 * 60_000,
      traveledMeters: 1500,
      remainingMeters: 3000,
    })).toBe("2026-08-22T17:00:00.000Z");
  });
});
