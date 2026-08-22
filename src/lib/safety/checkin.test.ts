import { describe, expect, it } from "vitest";
import {
  checkinStatus,
  formatCheckinLog,
  type CheckinEntry,
} from "./checkin";

describe("checkinStatus", () => {
  const settings = { enabled: true, intervalMin: 60 };
  const now = Date.parse("2026-08-20T12:00:00Z");

  it("prompts when enabled but no check-in yet", () => {
    expect(checkinStatus(null, settings, now)?.label).toMatch(/every 60 min/);
  });

  it("flags overdue check-ins", () => {
    const last = new Date(now - 75 * 60_000).toISOString();
    const status = checkinStatus(last, settings, now);
    expect(status?.overdue).toBe(true);
    expect(status?.label).toMatch(/OVERDUE/);
  });

  it("warns when due soon", () => {
    const last = new Date(now - 55 * 60_000).toISOString();
    expect(checkinStatus(last, settings, now)?.label).toMatch(/due in 5 min/);
  });

  it("is silent when not enabled", () => {
    expect(checkinStatus(null, { enabled: false, intervalMin: 60 }, now)).toBeNull();
  });

  it("overdues from the armed time if I'm OK was never tapped", () => {
    const status = checkinStatus(null, {
      enabled: true,
      intervalMin: 60,
      armedAt: new Date(now - 75 * 60_000).toISOString(),
    }, now);
    expect(status?.overdue).toBe(true);
  });
});

describe("formatCheckinLog", () => {
  it("formats entries with grid and note", () => {
    const entries: CheckinEntry[] = [
      {
        id: "1",
        packId: "p",
        recordedAt: "2026-08-20T10:00:00.000Z",
        lat: 37.5,
        lng: -119.5,
        note: "all ok",
      },
    ];
    expect(formatCheckinLog(entries)).toMatch(/37.50000/);
    expect(formatCheckinLog(entries)).toMatch(/all ok/);
  });
});

/**
 * Findings from the adversarial swarm, pass 18: every path that could disarm or
 * mis-arm the overdue monitor now fails closed or re-anchors, and no formatter can
 * take the panel down.
 */
describe("checkinStatus fails closed on untrustworthy time", () => {
  const now = Date.parse("2026-08-20T12:00:00Z");
  const settings = { enabled: true, intervalMin: 60 };

  it("alarms on a future-dated reference instead of waiting out the clock skew", () => {
    const future = new Date(now + 30 * 60_000).toISOString();
    const status = checkinStatus(future, settings, now);
    expect(status?.overdue).toBe(true);
    expect(status?.label).toMatch(/invalid/);
  });

  it("tolerates small skew without alarming", () => {
    const slightlyAhead = new Date(now + 60_000).toISOString();
    expect(checkinStatus(slightlyAhead, settings, now)?.overdue).toBeFalsy();
  });

  it("alarms on a corrupt interval instead of going silent forever", () => {
    const last = new Date(now - 30 * 60_000).toISOString();
    const status = checkinStatus(last, { enabled: true, intervalMin: Number.NaN }, now);
    expect(status?.overdue).toBe(true);
  });

  it("anchors the schedule to armedAt when the last check-in predates arming", () => {
    const staleCheckin = new Date(now - 4 * 60 * 60_000).toISOString();
    const armedAt = new Date(now - 1 * 60_000).toISOString();
    const status = checkinStatus(staleCheckin, { enabled: true, intervalMin: 60, armedAt }, now);
    expect(status?.overdue ?? false).toBe(false);
  });

  it("uses the check-in when it is fresher than armedAt", () => {
    const freshCheckin = new Date(now - 55 * 60_000).toISOString();
    const armedAt = new Date(now - 3 * 60 * 60_000).toISOString();
    const status = checkinStatus(freshCheckin, { enabled: true, intervalMin: 60, armedAt }, now);
    expect(status?.overdue).toBe(false);
    expect(status?.dueInMin).toBe(5);
  });

  it("degrades a large overdue figure to readable units", () => {
    const last = new Date(now - 50 * 60 * 60_000).toISOString();
    const status = checkinStatus(last, settings, now);
    expect(status?.overdue).toBe(true);
    expect(status?.label).toMatch(/2 d \d+ h|2 d —/);
    expect(status?.label).not.toMatch(/\d{4,} min/);
  });
});

describe("formatCheckinLog never throws", () => {
  it("renders a corrupt recordedAt as UNKNOWN instead of RangeError", () => {
    const entries = [
      { id: "1", packId: "p", recordedAt: "not-a-date" },
      { id: "2", packId: "p", recordedAt: "2026-08-20T11:00:00Z", note: "ok" },
    ] as CheckinEntry[];
    expect(() => formatCheckinLog(entries)).not.toThrow();
    const out = formatCheckinLog(entries);
    expect(out).toMatch(/time UNKNOWN/);
    expect(out).toMatch(/2026-08-20T11:00:00/);
  });
});
