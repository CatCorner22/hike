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
