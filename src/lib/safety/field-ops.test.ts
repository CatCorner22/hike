import { describe, expect, it } from "vitest";
import {
  gpsAnomalyWarning,
  heatHazard,
  heatIndexC,
  heatWarning,
  lightningRule,
  naismithMinutes,
  slopePercent,
  slopeWarning,
  windChillC,
  windChillHazard,
  windChillWarning,
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

  it("does not invent a heat index at the 27 °C / 40 % edge", () => {
    expect(heatIndexC(27, 40)).toBeNull();
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

/**
 * NWS computes a heat index at ANY humidity — the low-RH adjustment exists precisely
 * for dry air. The old RH>=40 gate meant desert heat produced no advisory at all, and
 * independent 60°C/100% caps admitted physically impossible airmasses ("Heat index
 * 339°C"). Reference values from the WPC heat-index equation.
 */
describe("heatIndexC across the full humidity range", () => {
  it("warns in hot-dry air (the old gate returned null below RH 40)", () => {
    expect(heatIndexC(43, 20)).toBeCloseTo(43.9, 0);
    expect(heatIndexC(45, 25)).toBeCloseTo(50.5, 0);
    expect(heatIndexC(38, 10)).toBeCloseTo(34.7, 0);
    expect(heatWarning(43, 20)).toMatch(/Heat index/);
  });

  it("applies the NWS high-RH adjustment in humid heat", () => {
    const hi = heatIndexC(27, 100);
    expect(hi).not.toBeNull();
    expect(hi!).toBeGreaterThanOrEqual(32);
    expect(heatWarning(27, 100)).toMatch(/slow the pace/);
  });

  it("rejects jointly impossible hot-humid input instead of diverging", () => {
    expect(heatIndexC(60, 60)).toBeNull();
    expect(heatIndexC(55, 80)).toBeNull();
    expect(heatIndexC(45, 25)).not.toBeNull();
  });
});

/**
 * ECCC applies its frostbite bands to the chill value, and in calm air the chill value
 * is the air temperature. Returning null below the formula's 5 km/h floor made -35°C
 * still air read as "no cold hazard" while frostbiteMinutes warned for the same input.
 */
describe("windChillWarning in calm air", () => {
  it("falls back to ambient temperature below 5 km/h", () => {
    expect(windChillWarning(-35, 0)).toMatch(/frostbite risk in minutes/);
    expect(windChillWarning(-15, 2)).toMatch(/wind layer/);
    expect(windChillWarning(-35, 0)).toMatch(/Air temperature/);
  });

  it("keeps the formula path and domain guards", () => {
    expect(windChillWarning(-20, 30)).toMatch(/Wind chill/);
    expect(windChillWarning(15, 0)).toBeNull();
    expect(windChillWarning(Number.NaN, 10)).toBeNull();
  });
});

/**
 * Regression: the renderer styled the cold/heat warnings by sniffing the text and
 * got it wrong — "frostbite risk in minutes" was typeset in the muted placeholder
 * gray. The module grades the band itself so no renderer re-derives severity from
 * substrings.
 */
describe("thermal hazard severity accompanies the text", () => {
  it("grades wind chill bands", () => {
    expect(windChillHazard(-35, 0)).toMatchObject({ severity: "danger" });
    expect(windChillHazard(-15, 2)).toMatchObject({ severity: "advisory" });
    expect(windChillHazard(0, 2)).toMatchObject({ severity: "info" });
    expect(windChillHazard(15, 0)).toBeNull();
  });

  it("grades heat index bands", () => {
    expect(heatHazard(43, 30)).toMatchObject({ severity: "danger" });
    expect(heatHazard(27, 100)).toMatchObject({ severity: "advisory" });
    expect(heatHazard(20, 50)).toBeNull();
  });

  it("keeps the string API as a pure view of the graded result", () => {
    expect(windChillWarning(-35, 0)).toBe(windChillHazard(-35, 0)!.text);
    expect(heatWarning(43, 30)).toBe(heatHazard(43, 30)!.text);
  });
});

/**
 * The speed test normalizes by dt, so a longer gap only makes the inference safer —
 * yet any teleport across a gap over 20 s used to be silently accepted.
 */
describe("gpsAnomalyWarning across long gaps", () => {
  const base = 1_700_000_000_000;
  it("flags a teleport across a one-minute gap", () => {
    const warning = gpsAnomalyWarning([
      { lat: 37.0, lng: -119.0, recordedAt: base },
      { lat: 37.0001, lng: -119.0, recordedAt: base + 10_000 },
      { lat: 41.5, lng: -119.0, recordedAt: base + 70_000 },
    ]);
    expect(warning).toMatch(/GPS jumped/);
  });

  it("accepts ordinary hiking progress across the same gap", () => {
    const warning = gpsAnomalyWarning([
      { lat: 37.0, lng: -119.0, recordedAt: base },
      { lat: 37.0001, lng: -119.0, recordedAt: base + 10_000 },
      { lat: 37.0009, lng: -119.0, recordedAt: base + 70_000 },
    ]);
    expect(warning).toBeNull();
  });
});
