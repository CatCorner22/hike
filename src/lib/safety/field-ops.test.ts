import { describe, expect, it } from "vitest";
import {
  gpsAnomalyWarning,
  heatIndexC,
  lightningRule,
  naismithMinutes,
  slopePercent,
  slopeWarning,
  windChillC,
} from "./field-ops";

describe("field weather / movement", () => {
  it("computes a meaningful wind chill", () => {
    const wc = windChillC(-10, 40);
    expect(wc).not.toBeNull();
    expect(wc!).toBeLessThan(-10);
  });

  it("computes heat index in hot humid air", () => {
    const hi = heatIndexC(32, 70);
    expect(hi).not.toBeNull();
    expect(hi!).toBeGreaterThan(32);
  });

  it("applies the 30–30 lightning rule", () => {
    const close = lightningRule(15);
    expect(close).not.toBeNull();
    expect(close!.km).toBeCloseTo(5, 0);
    expect(close!.warning).toMatch(/NOW/);
    expect(lightningRule(90)?.warning).toMatch(/30–30/);
  });

  it("uses Naismith for time with climb", () => {
    expect(naismithMinutes(5000, 0)).toBe(60);
    expect(naismithMinutes(5000, 600)).toBe(120);
  });

  it("reports slope percent", () => {
    expect(slopePercent(100, 400)).toBeCloseTo(25);
  });
});

describe("gpsAnomalyWarning", () => {
  it("flags a teleport", () => {
    const t0 = Date.parse("2026-08-19T18:00:00Z");
    const msg = gpsAnomalyWarning([
      { lat: 37.0, lng: -119.0, recordedAt: t0 },
      { lat: 37.0, lng: -119.0, recordedAt: t0 + 4000 },
      { lat: 37.02, lng: -119.0, recordedAt: t0 + 6000 },
    ]);
    expect(msg).toMatch(/jumped/);
  });

  it("stays quiet on a walking track", () => {
    const t0 = Date.parse("2026-08-19T18:00:00Z");
    expect(
      gpsAnomalyWarning([
        { lat: 37.0, lng: -119.0, recordedAt: t0 },
        { lat: 37.0001, lng: -119.0, recordedAt: t0 + 8000 },
        { lat: 37.0002, lng: -119.0, recordedAt: t0 + 16000 },
      ]),
    ).toBeNull();
  });
});

describe("slopeWarning", () => {
  it("warns on a steep climb", () => {
    expect(slopeWarning(45)).toMatch(/Class 3\/4/);
    expect(slopeWarning(30)).toMatch(/steep/);
    expect(slopeWarning(10)).toBeNull();
  });

  // Regression: slopeFromProfile returns a signed grade, and the thresholds only tested
  // `percent >= n`, so every descent was silently rated safe — including the 45% ones
  // where people actually fall.
  it("warns on a steep descent just as loudly", () => {
    expect(slopeWarning(-45)).toMatch(/Class 3\/4/);
    expect(slopeWarning(-45)).toMatch(/descent/);
    expect(slopeWarning(-30)).toMatch(/steep/);
    expect(slopeWarning(-10)).toBeNull();
  });

  it("agrees on magnitude regardless of direction", () => {
    for (const grade of [5, 20, 24, 25, 26, 44, 45, 46, 80]) {
      expect(Boolean(slopeWarning(grade)), `${grade}%`).toBe(Boolean(slopeWarning(-grade)));
    }
  });
});
