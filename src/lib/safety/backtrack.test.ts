import { describe, expect, it } from "vitest";
import {
  backtrackProgress,
  gainLastHourM,
  rapidAscentWarning,
  reverseTrackLine,
  reverseTrackSegments,
  backtrackAlongContiguousTrack,
  isBreadcrumbGap,
  stationaryMinutes,
} from "./backtrack";
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

describe("rapidAscentWarning", () => {
  it("uses the lowest point in the hour, not just first-to-last", () => {
    const now = Date.parse("2026-08-19T18:00:00Z");
    const points = [
      { lat: 37, lng: -119, altitude: 2500, recordedAt: now - 50 * 60_000 },
      { lat: 37, lng: -119, altitude: 2100, recordedAt: now - 30 * 60_000 },
      { lat: 37, lng: -119, altitude: 2300, recordedAt: now - 15 * 60_000 },
      { lat: 37, lng: -119, altitude: 2550, recordedAt: now },
    ];
    expect(rapidAscentWarning(points, now)).toMatch(/450/);
  });
});

describe("overdueStatus", () => {
  it("marks a past return time as overdue", () => {
    const status = overdueStatus("2026-08-19T10:00:00Z", Date.parse("2026-08-19T12:00:00Z"));
    expect(status).not.toBeNull();
    expect(status!.overdue).toBe(true);
    expect(status!.label).toMatch(/OVERDUE/);
  });

  it("counts down before the return time", () => {
    const status = overdueStatus("2026-08-19T14:00:00Z", Date.parse("2026-08-19T12:00:00Z"));
    expect(status!.overdue).toBe(false);
    expect(status!.remainingMin).toBe(120);
  });

  // Regression: an unparseable stored time produced NaN, which is neither <= 0 nor > 0,
  // so the alarm reported "Return in NaN min" and never fired. Downstream, the panel fed
  // the same value to new Date(...).toISOString(), which throws and kills the screen.
  it("fails closed on an unreadable return time and never prints NaN", () => {
    // Callers render `label` directly. A corrupt deadline must warn (fail closed)
    // and must not silently read as fine or print "Return in NaN min".
    for (const bad of ["garbage", "", "NaN-NaN-NaNTNaN:NaN"]) {
      const status = overdueStatus(bad);
      expect(status.overdue).toBe(true);
      expect(status.remainingMin).toBeNull();
      expect(status.label).toMatch(/invalid/i);
      expect(status.label).not.toMatch(/NaN/);
    }
  });
});

describe("track points that cannot be trusted", () => {
  const now = Date.parse("2026-08-21T02:00:00Z");
  const at = (minutesAgo: number, extra: Record<string, unknown> = {}) => ({
    lat: 37.7,
    lng: -119.6,
    recordedAt: new Date(now - minutesAgo * 60_000).toISOString(),
    ...extra,
  });
  const climb = [
    at(55, { altitude: 2000 }),
    at(40, { altitude: 2200 }),
    at(20, { altitude: 2500 }),
    at(0, { altitude: 2900 }),
  ];

  /**
   * `sampleTime` guards `Date.parse` with `Number.isFinite`; `stationaryMinutes`, in the
   * same file, called it raw. One unparseable timestamp made `oldest` NaN and the whole
   * result NaN — and NaN compares false against every threshold, so the not-moving
   * warning silently stopped firing rather than reporting anything wrong.
   */
  it("does not return NaN minutes when one timestamp is corrupt", () => {
    const clean = stationaryMinutes([at(40), at(20), at(0)], now);
    expect(clean).toBe(40);
    for (const corrupt of ["not-a-date", "2026-13-45T99:99:99Z", "undefined"]) {
      const result = stationaryMinutes(
        [at(40), { lat: 37.7, lng: -119.6, recordedAt: corrupt }, at(0)],
        now,
      );
      expect(Number.isFinite(result), corrupt).toBe(true);
      expect(result).toBeGreaterThanOrEqual(0);
    }
  });

  /**
   * `altitude != null` lets NaN through, and one NaN poisons Math.min. A real 900 m
   * ascent came back NaN, which deleted the warning entirely and zeroed the
   * altitude-illness exposure that feeds `amsAssessment`.
   */
  it("keeps the rapid-ascent warning when one altitude sample is NaN", () => {
    expect(gainLastHourM(climb, now)).toBeCloseTo(900, 0);
    expect(rapidAscentWarning(climb, now)).toMatch(/gained ~900 m/);

    const poisoned = [
      ...climb.slice(0, 2),
      at(30, { altitude: Number.NaN }),
      ...climb.slice(2),
    ];
    expect(gainLastHourM(poisoned, now)).toBeCloseTo(900, 0);
    expect(rapidAscentWarning(poisoned, now)).toMatch(/gained ~900 m/);
  });

  /**
   * The window test was `now - t <= windowMs`, which any future timestamp satisfies.
   * A point dated 90 minutes ahead at 9 000 m produced "You gained ~7000 m in the last
   * hour" — an impossible rate, and the kind of false alarm that trains a party to stop
   * believing the warning bar.
   */
  it("ignores points dated in the future", () => {
    const withFuture = [...climb, at(-90, { altitude: 9000 })];
    expect(gainLastHourM(withFuture, now)).toBeCloseTo(900, 0);
    expect(rapidAscentWarning(withFuture, now)).toMatch(/gained ~900 m/);
    expect(rapidAscentWarning(withFuture, now)).not.toMatch(/7000/);
    // A little clock skew is still tolerated rather than discarding good data.
    const slightlyAhead = [...climb.slice(0, 3), at(-1, { altitude: 2900 })];
    expect(gainLastHourM(slightlyAhead, now)).toBeCloseTo(900, 0);
  });

  /**
   * A corrupt timestamp must be dropped from the altitude window, not read as "now".
   * Treated as current it sorts to the end and becomes the *latest* altitude, so one
   * unparseable sample at 5 000 m turned a 900 m ascent into a reported 3 000 m.
   */
  it("drops a corrupt-timestamped altitude instead of treating it as the current one", () => {
    const poisoned = [
      ...climb,
      { lat: 37.7, lng: -119.6, recordedAt: "not-a-date", altitude: 5000 },
    ];
    expect(gainLastHourM(poisoned, now)).toBeCloseTo(900, 0);
    expect(rapidAscentWarning(poisoned, now)).toMatch(/gained ~900 m/);
    expect(rapidAscentWarning(poisoned, now)).not.toMatch(/3000/);
  });

  it("still reports nothing rather than guessing when the window is empty", () => {
    expect(gainLastHourM([], now)).toBe(0);
    expect(rapidAscentWarning([], now)).toBeNull();
    expect(stationaryMinutes([], now)).toBe(0);
    expect(gainLastHourM(climb, Number.NaN)).toBe(0);
  });
});

/**
 * Regression: `reverseTrackLine` joined every consecutive pair with no gap
 * check, and `backtrackProgress` handed that geometry straight to
 * `progressAlongTrail` for bearing and distance. A pocketed phone, a suspended
 * GPS watch or a flat battery leaves a hole, and two points 4 km apart become a
 * chord across a drainage and a cliff band the hiker actually walked around.
 * The map draws it as one unbroken dashed polyline, so there is no visual tell,
 * and "Remaining" and "Est. time back" are computed off the same fabrication.
 * The seventeenth pass audited this file for NaN and future timestamps and never
 * looked at the line it builds.
 */
describe("a retrace that stops at the hole in the breadcrumb", () => {
  const minute = 60_000;
  const start = Date.parse("2026-08-23T15:00:00.000Z");
  // Walking east along a line, then a 90-minute hole, then more points.
  // The older run, before the phone went in a pocket.
  const beforeGap = [0, 1].map((i) => ({
    lat: 37.02,
    lng: -119.05 + i * 0.001,
    recordedAt: start + i * minute,
  }));
  // The run leading up to where the hiker is standing now, 90 minutes later.
  const contiguous = [0, 1, 2].map((i) => ({
    lat: 37.0,
    lng: -119.0 + i * 0.001,
    recordedAt: start + 90 * minute + i * minute,
  }));
  // Oldest first, the order the recorder appends in.
  const track = [...beforeGap, ...contiguous];

  it("recognises a hole by time or by impossible distance", () => {
    expect(isBreadcrumbGap(contiguous[0], contiguous[1])).toBe(false);
    expect(isBreadcrumbGap(beforeGap[1], contiguous[0])).toBe(true);
    // Distance alone is enough, even with no timestamps at all.
    expect(isBreadcrumbGap({ lat: 37, lng: -119 }, { lat: 37, lng: -118.9 })).toBe(true);
  });

  it("splits the reversed track instead of bridging it", () => {
    const segments = reverseTrackSegments(track);
    expect(segments).toHaveLength(2);
    expect(segments[0].coordinates).toHaveLength(3);
    // The first segment is the run leading back from where the hiker is now.
    expect(segments[0].coordinates[0]).toEqual([contiguous[2].lng, contiguous[2].lat]);
  });

  it("reports the gap rather than quoting a bearing across it", () => {
    const here = { lat: 37.0, lng: -119.002 };
    const result = backtrackAlongContiguousTrack(here, track);
    expect(result.gapAhead).not.toBeNull();
    // beforeGap[1] at +1 min, contiguous[0] at +90: 89 minutes unrecorded.
    expect(result.gapAhead!.minutes).toBe(89);
    expect(result.gapAhead!.meters).toBeGreaterThan(1_000);
    // Guidance is still given along the part that was actually recorded.
    expect(result.progress).not.toBeNull();
  });

  it("says nothing about a gap when the track has none", () => {
    const result = backtrackAlongContiguousTrack({ lat: 37.0, lng: -119.002 }, contiguous);
    expect(result.gapAhead).toBeNull();
    expect(result.progress).not.toBeNull();
  });
});
