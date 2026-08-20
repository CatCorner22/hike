import { describe, expect, it } from "vitest";
import {
  estimateWbgtC,
  frostbiteMinutes,
  heatCategory,
  heatIllnessTriage,
  hypothermiaStage,
  workRestCycle,
} from "./thermal";

describe("thermal heat controls", () => {
  it("uses the TB MED 507 heat-category boundaries", () => {
    expect(heatCategory(27.7)).toMatchObject({ category: 1, flag: "white" });
    expect(heatCategory(27.8)).toMatchObject({ category: 2, flag: "green" });
    expect(heatCategory(29.4)).toMatchObject({ category: 3, flag: "yellow" });
    expect(heatCategory(31.1)).toMatchObject({ category: 4, flag: "red" });
    expect(heatCategory(32.2)).toMatchObject({ category: 5, flag: "black" });
  });

  it("uses a conservative work-rest plan with a prominent hyponatremia cap", () => {
    const plan = workRestCycle(32.2, "hard");
    expect(plan).toMatchObject({ category: 5, workMinutes: 10, restMinutes: 50, waterLitersPerHour: 1 });
    expect(plan?.note).toMatch(/1\.5 L\/hour.*12 L\/day.*hyponatremia/i);
  });

  it("estimates WBGT only for a valid temperature and humidity input", () => {
    expect(estimateWbgtC({ tempC: 32, rhPct: 70, inSun: true })).toBeGreaterThan(25);
    expect(estimateWbgtC({ tempC: Number.NaN, rhPct: 70, inSun: true })).toBeNull();
  });
});

describe("thermal medical triage", () => {
  it("returns no timed frostbite risk in mild weather", () => {
    expect(frostbiteMinutes(5, 10)).toBeNull();
  });

  it("returns a timed frostbite risk in severe wind chill", () => {
    expect(frostbiteMinutes(-30, 30)).toBeLessThanOrEqual(10);
  });

  it("treats altered mental status in heat as heat stroke", () => {
    const result = heatIllnessTriage({ coreTempC: 40.5, alteredMental: true, sweating: true, crampsOnly: false });
    expect(result).toMatchObject({ condition: "stroke", severity: "critical" });
    expect(result?.actions.join(" ")).toMatch(/cold-water immersion/i);
  });

  it("includes gentle handling in severe hypothermia", () => {
    const result = hypothermiaStage({ coreTempC: 27, shivering: false, alteredMental: true, conscious: false });
    expect(result).toMatchObject({ stage: "severe", severity: "critical" });
    expect(result?.actions.join(" ")).toMatch(/handle gently/i);
  });

  it("returns null for a NaN core temperature", () => {
    expect(hypothermiaStage({ coreTempC: Number.NaN, shivering: true, alteredMental: false, conscious: true })).toBeNull();
  });
});
