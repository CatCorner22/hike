import { describe, expect, it } from "vitest";
import {
  assessDaylightMargin,
  guardianStatus,
  nextDecisionPoint,
} from "@/lib/safety/decision-support";

/**
 * These are the calculations that tell a hiker whether to turn around before
 * dark, and whether their overdue deadline has passed. Every unusable input
 * previously resolved to the reassuring answer: an unknown remaining distance
 * reported 527 minutes of daylight margin, an unreadable clock reported
 * "on-time", and several paths rendered "NaN min".
 */
describe("decision support never reassures on unusable input", () => {
  const base = { now: new Date("2026-08-20T18:00:00Z"), lat: 37.77, lng: -119.53 };

  const unusable: Array<[string, Parameters<typeof assessDaylightMargin>[0]]> = [
    ["no pace", { ...base, remainingMeters: 20_000, paceMetersPerHour: Number.NaN }],
    ["zero pace", { ...base, remainingMeters: 20_000, paceMetersPerHour: 0 }],
    ["negative pace", { ...base, remainingMeters: 20_000, paceMetersPerHour: -5 }],
    ["unknown distance", { ...base, remainingMeters: Number.NaN, paceMetersPerHour: 3000 }],
    ["negative distance", { ...base, remainingMeters: -1, paceMetersPerHour: 3000 }],
    [
      "unreadable clock",
      { now: new Date("nonsense"), lat: 37.77, lng: -119.53, remainingMeters: 20_000, paceMetersPerHour: 3000 },
    ],
    ["impossible latitude", { ...base, lat: 100, lng: -119.53, remainingMeters: 20_000, paceMetersPerHour: 3000 }],
    ["non-finite position", { ...base, lat: Number.NaN, lng: Number.NaN, remainingMeters: 20_000, paceMetersPerHour: 3000 }],
  ];

  it.each(unusable)("reports unknown rather than ok for %s", (_label, input) => {
    const result = assessDaylightMargin(input);
    expect(result.severity).toBe("unknown");
    expect(result.marginMinutes).toBeNull();
    expect(result.message).not.toMatch(/NaN|Infinity/);
    // The message must tell the hiker what to do about it.
    expect(result.message).toMatch(/cannot be calculated/i);
    expect(result.message).toMatch(/darkness/i);
  });

  it("still gives a real answer for usable input", () => {
    const result = assessDaylightMargin({ ...base, remainingMeters: 20_000, paceMetersPerHour: 3000 });
    expect(result.severity).not.toBe("unknown");
    expect(typeof result.marginMinutes).toBe("number");
    expect(result.message).not.toMatch(/NaN/);
  });

  it("escalates as the daylight margin shrinks", () => {
    const ok = assessDaylightMargin({ ...base, remainingMeters: 5_000, paceMetersPerHour: 4000 });
    const critical = assessDaylightMargin({ ...base, remainingMeters: 90_000, paceMetersPerHour: 3000 });
    expect(ok.severity).toBe("ok");
    expect(critical.severity).toBe("critical");
    expect(critical.marginMinutes!).toBeLessThan(ok.marginMinutes!);
  });

  it("ignores a nonsensical reserve rather than disabling the watch band", () => {
    // A negative reserve would otherwise make the "watch" band unreachable.
    const result = assessDaylightMargin({
      ...base,
      remainingMeters: 20_000,
      paceMetersPerHour: 3000,
      reserveMinutes: -10_000,
    });
    expect(result.severity).not.toBe("unknown");
    expect(result.marginMinutes).toBeGreaterThan(0);
  });
});

describe("guardianStatus is honest about an unreadable clock", () => {
  it("does not report on-time when the current time is unusable", () => {
    const status = guardianStatus(new Date("nonsense"), new Date("2026-08-20T22:00:00Z"));
    expect(status.state).toBe("unknown");
    expect(status.minutesToDeadline).toBeNull();
    expect(status.message).not.toMatch(/NaN/);
    expect(status.message).toMatch(/clock/i);
  });

  it("still reports a real deadline correctly", () => {
    const now = new Date("2026-08-20T18:00:00Z");
    expect(guardianStatus(now, new Date("2026-08-20T18:30:00Z")).state).toBe("due-soon");
    expect(guardianStatus(now, new Date("2026-08-20T17:00:00Z")).state).toBe("overdue");
    expect(guardianStatus(now, new Date("2026-08-21T06:00:00Z")).state).toBe("on-time");
  });
});

describe("nextDecisionPoint does not hide bailouts", () => {
  const points = [
    { id: "b", name: "Bailout", distanceMeters: 4000, kind: "bailout" as const },
    { id: "a", name: "Junction", distanceMeters: 1000, kind: "junction" as const },
  ];

  it("returns the first point when the travelled distance is unknown", () => {
    // Every comparison against NaN is false, which previously returned null and
    // showed the hiker no upcoming bailout at all.
    expect(nextDecisionPoint(points, Number.NaN)?.id).toBe("a");
  });

  it("returns the next point ahead in normal use", () => {
    expect(nextDecisionPoint(points, 1500)?.id).toBe("b");
    expect(nextDecisionPoint(points, 9000)).toBeNull();
  });
});
