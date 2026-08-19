import { describe, expect, it } from "vitest";
import {
  breadcrumbGpx,
  hypothermiaWarning,
  isIceFilled,
  nearestWaypoint,
  safetySelfCheck,
  suddenStopWarning,
  waterReminder,
} from "./field";

describe("hypothermiaWarning", () => {
  it("warns at night above 2,000 m", () => {
    expect(hypothermiaWarning({ isDark: true, altitudeM: 2400 })).toMatch(/hypothermia/);
  });

  it("stays quiet on a warm sunny day", () => {
    expect(hypothermiaWarning({ isDark: false, altitudeM: 1200, stationaryMin: 5 })).toBeNull();
  });
});

describe("waterReminder", () => {
  const start = Date.parse("2026-08-19T16:00:00Z");
  it("is silent until the interval elapses", () => {
    expect(waterReminder(start, start, start + 10 * 60_000)).toBeNull();
  });

  it("nags after 30 minutes without a sip", () => {
    expect(waterReminder(null, start, start + 35 * 60_000)).toMatch(/35 min/);
  });
});

describe("suddenStopWarning", () => {
  it("flags a walking pace that collapses to still", () => {
    const t0 = Date.parse("2026-08-19T18:00:00Z");
    const points = [
      { lat: 37.0, lng: -119.0, recordedAt: t0 },
      { lat: 37.00016, lng: -119.0, recordedAt: t0 + 8_000 },
      { lat: 37.00032, lng: -119.0, recordedAt: t0 + 16_000 },
      { lat: 37.00033, lng: -119.0, recordedAt: t0 + 24_000 },
    ];
    expect(suddenStopWarning(points, t0 + 25_000)).toMatch(/fell/);
  });

  it("ignores a slow walk", () => {
    const t0 = Date.parse("2026-08-19T18:00:00Z");
    const points = [
      { lat: 37.0, lng: -119.0, recordedAt: t0 },
      { lat: 37.00004, lng: -119.0, recordedAt: t0 + 10_000 },
      { lat: 37.00008, lng: -119.0, recordedAt: t0 + 20_000 },
      { lat: 37.00012, lng: -119.0, recordedAt: t0 + 30_000 },
    ];
    expect(suddenStopWarning(points, t0 + 31_000)).toBeNull();
  });
});

describe("nearestWaypoint", () => {
  it("picks the closest marked point", () => {
    const near = nearestWaypoint({ lat: 37, lng: -119 }, [
      { id: "a", kind: "water", lat: 37.01, lng: -119 },
      { id: "b", kind: "lkp", lat: 37.001, lng: -119 },
    ]);
    expect(near?.point.id).toBe("b");
    expect(near?.label).toMatch(/LKP/);
  });
});

describe("safetySelfCheck", () => {
  it("lists missing ICE and crumbs as not ok", () => {
    const items = safetySelfCheck({
      packReady: true,
      gpsTrusted: false,
      iceFilled: false,
      returnSet: false,
      wakeLock: false,
      crumbs: 0,
    });
    expect(items.filter((i) => !i.ok).map((i) => i.id)).toEqual(
      expect.arrayContaining(["gps", "ice", "return", "wake", "crumbs"]),
    );
  });
});

describe("isIceFilled", () => {
  it("requires a name and a real phone", () => {
    expect(isIceFilled({ name: "", iceName: "Pat", icePhone: "555-1212", medical: "", partySize: 1 })).toBe(
      true,
    );
    expect(isIceFilled({ name: "", iceName: "P", icePhone: "12", medical: "", partySize: 1 })).toBe(false);
  });
});

describe("breadcrumbGpx", () => {
  it("emits a GPX track with time", () => {
    const gpx = breadcrumbGpx("Mist", [
      { lat: 37.1, lng: -119.2, altitude: 1200, recordedAt: "2026-08-19T18:00:00.000Z" },
      { lat: 37.11, lng: -119.2, recordedAt: "2026-08-19T18:10:00.000Z" },
    ]);
    expect(gpx).toContain("<gpx");
    expect(gpx).toContain('lat="37.1"');
    expect(gpx).toContain("<time>2026-08-19T18:00:00.000Z</time>");
  });
});
