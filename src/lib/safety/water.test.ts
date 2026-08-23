import { describe, expect, it } from "vitest";
import {
  boilTimeMinutes,
  chemicalDoseWaitMinutes,
  hydrationPlan,
  sourceRisk,
  sweatRateLitersPerHour,
} from "./water";

describe("water treatment", () => {
  it("extends boiling time at the 2,000 m threshold", () => {
    expect(boilTimeMinutes(1999)).toBe(1);
    expect(boilTimeMinutes(2000)).toBe(3);
    expect(boilTimeMinutes(Number.NaN)).toBeNull();
  });

  it("makes visible algae a hard stop before treatment", () => {
    const risk = sourceRisk({
      source: "lake",
      upstreamGrazing: false,
      upstreamCamping: false,
      algaeVisible: true,
    });
    expect(risk.severity).toBe("critical");
    expect(risk.treatBefore).toBe(true);
    expect(risk.message).toMatch(/HARD STOP/);
    expect(risk.message).toMatch(/cyanotoxins/i);
  });

  it("extends chemical contact time in cold or cloudy water", () => {
    const warmClear = chemicalDoseWaitMinutes({
      method: "bleach",
      waterTempC: 20,
      cloudy: false,
    });
    const coldClear = chemicalDoseWaitMinutes({
      method: "bleach",
      waterTempC: 5,
      cloudy: false,
    });
    expect(coldClear).toBeGreaterThan(warmClear!);
    expect(
      chemicalDoseWaitMinutes({ method: "chlorine-dioxide", waterTempC: Number.NaN, cloudy: false }),
    ).toBeNull();
  });
});

describe("hydration planning", () => {
  it("caps the conservative hourly estimate at 1.5 L/h", () => {
    expect(sweatRateLitersPerHour({ tempC: 45, workRate: "hard", acclimatized: false })).toBe(1.5);
    const plan = hydrationPlan({ hours: 2, tempC: 45, workRate: "hard" });
    expect(plan?.liters).toBe(3);
    expect(plan?.kg).toBe(3);
    expect(plan?.note).toMatch(/hyponatremia/i);
  });

  it("rejects invalid hydration inputs", () => {
    expect(sweatRateLitersPerHour({ tempC: Number.NaN, workRate: "easy", acclimatized: true })).toBeNull();
    expect(hydrationPlan({ hours: Number.NaN, tempC: 20, workRate: "easy" })).toBeNull();
  });
});

describe("chemicalDoseWaitMinutes — cold water", () => {
  // Regression: sub-zero was rejected outright, so near-freezing meltwater — the case
  // that most needs the extended contact time — produced no guidance at all.
  it("answers for near-freezing meltwater", () => {
    // Cold doubles the contact time (CDC / halogen label doctrine), it does not 1.5x it:
    // published Giardia CT for iodine roughly doubles to triples from 25 C to 5 C.
    expect(chemicalDoseWaitMinutes({ method: "chlorine-dioxide", waterTempC: -1, cloudy: false })).toBe(480);
    expect(chemicalDoseWaitMinutes({ method: "iodine", waterTempC: 0, cloudy: false })).toBe(60);
  });

  it("extends contact time as water gets colder or cloudier", () => {
    const warm = chemicalDoseWaitMinutes({ method: "iodine", waterTempC: 20, cloudy: false })!;
    const cold = chemicalDoseWaitMinutes({ method: "iodine", waterTempC: 2, cloudy: false })!;
    const coldCloudy = chemicalDoseWaitMinutes({ method: "iodine", waterTempC: 2, cloudy: true })!;
    expect(cold).toBeGreaterThan(warm);
    expect(coldCloudy).toBeGreaterThan(cold);
  });

  it("still rejects impossible temperatures", () => {
    expect(chemicalDoseWaitMinutes({ method: "iodine", waterTempC: -40, cloudy: false })).toBeNull();
    expect(chemicalDoseWaitMinutes({ method: "iodine", waterTempC: 80, cloudy: false })).toBeNull();
  });
});
