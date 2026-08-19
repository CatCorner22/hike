import { describe, expect, it } from "vitest";
import { daylightStatus, daylightWarning } from "./daylight";

describe("daylightStatus", () => {
  it("treats mid-afternoon in California as daylight", () => {
    const afternoon = new Date("2026-06-21T21:00:00Z"); // 2pm PDT
    const status = daylightStatus(afternoon, 37.77, -122.42);
    expect(status.isDark).toBe(false);
    expect(status.minutesUntilSunset).toBeGreaterThan(60);
    expect(status.warning).toBeNull();
  });

  it("warns after local sunset", () => {
    const night = new Date("2026-06-22T06:00:00Z"); // 11pm PDT
    const status = daylightStatus(night, 37.77, -122.42);
    expect(status.isDark).toBe(true);
    expect(status.warning).toMatch(/dark/i);
  });

  it("warns in the hour before sunset", () => {
    expect(daylightWarning(45, false)).toMatch(/sunset/i);
    expect(daylightWarning(10, false)).toMatch(/turnaround/i);
  });
});
