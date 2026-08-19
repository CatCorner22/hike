import { describe, expect, it } from "vitest";
import { backtrackProgress, reverseTrackLine, stationaryMinutes } from "./backtrack";
import { overdueStatus } from "./profile";

describe("backtrack", () => {
  const points = [
    { lat: 37.0, lng: -119.0 },
    { lat: 37.002, lng: -119.0 },
    { lat: 37.004, lng: -119.0 },
  ];

  it("reverses the breadcrumb line toward the start", () => {
    const line = reverseTrackLine(points);
    expect(line?.coordinates[0][1]).toBeCloseTo(37.004);
    expect(line?.coordinates.at(-1)?.[1]).toBeCloseTo(37.0);
  });

  it("measures remaining distance back along the crumbs", () => {
    const progress = backtrackProgress({ lat: 37.004, lng: -119.0 }, points);
    expect(progress).not.toBeNull();
    expect(progress!.remainingMeters).toBeGreaterThan(300);
  });
});

describe("stationaryMinutes", () => {
  it("counts time spent inside a small radius", () => {
    const now = Date.parse("2026-08-19T18:00:00Z");
    const points = [
      { lat: 37.0, lng: -119.0, recordedAt: now - 25 * 60_000 },
      { lat: 37.00005, lng: -119.0, recordedAt: now },
    ];
    expect(stationaryMinutes(points, now)).toBeGreaterThanOrEqual(20);
  });
});

describe("overdueStatus", () => {
  it("marks a past return time as overdue", () => {
    const status = overdueStatus("2026-08-19T10:00:00Z", Date.parse("2026-08-19T12:00:00Z"));
    expect(status.overdue).toBe(true);
    expect(status.label).toMatch(/OVERDUE/);
  });
});
