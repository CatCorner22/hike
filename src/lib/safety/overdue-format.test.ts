import { describe, expect, it } from "vitest";
import { overdueStatus } from "@/lib/safety/profile";

describe("overdue deadline formatting", () => {
  const now = Date.parse("2026-08-20T12:00:00Z");
  it("uses minutes, hours then days", () => {
    expect(overdueStatus(new Date(now + 30 * 60000).toISOString(), now).label).toMatch(/Return in 30 min/);
    expect(overdueStatus(new Date(now + 150 * 60000).toISOString(), now).label).toMatch(/2 h 30 min/);
    expect(overdueStatus(new Date(now - 26 * 3600_000).toISOString(), now).label).toMatch(/1 d 2 h/);
  });
  it("caps an absurd clock rather than printing millions of minutes", () => {
    const label = overdueStatus(new Date(0).toISOString(), now).label;
    expect(label).toMatch(/OVERDUE by/);
    expect(label).toMatch(/check the device clock/);
    expect(label).not.toMatch(/\d{6,}/);
  });
  it("still says OVERDUE and still tells you to act", () => {
    const s = overdueStatus(new Date(now - 90 * 60000).toISOString(), now);
    expect(s.overdue).toBe(true);
    expect(s.label).toMatch(/OVERDUE/);
    expect(s.label).toMatch(/SOS|check in/);
  });
});
