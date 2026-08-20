import { describe, expect, it } from "vitest";
import {
  TERRAIN_FACTORS,
  calorieRequirement,
  loadPlan,
  packWeightAdvice,
  pandolfWatts,
  waterRequirementLiters,
} from "./load";

describe("Pandolf load carriage", () => {
  it("matches a hand-verified Pandolf reference on an uphill paved route", () => {
    // W=70, L=20, V=1, G=5, n=1: 105 + 2*90*(20/70)^2 (14.6939) + 90*(1.5 + 1.75) (292.5) = 412.1939 W.
    expect(pandolfWatts({ bodyMassKg: 70, loadKg: 20, speedMs: 1, gradePct: 5, terrain: "paved" })).toBe(412.2);
  });

  it("scales the moving term with the terrain factor", () => {
    const paved = pandolfWatts({ bodyMassKg: 70, loadKg: 20, speedMs: 1, gradePct: 5, terrain: "paved" });
    const sand = pandolfWatts({ bodyMassKg: 70, loadKg: 20, speedMs: 1, gradePct: 5, terrain: "loose-sand" });
    expect(TERRAIN_FACTORS["loose-sand"]).toBe(2.1);
    expect(sand).toBeGreaterThan(paved!);
  });

  it("applies the Santee downhill correction only on negative grades", () => {
    const zero = pandolfWatts({ bodyMassKg: 70, loadKg: 20, speedMs: 1.1, gradePct: 0, terrain: "paved" });
    const downhill = pandolfWatts({ bodyMassKg: 70, loadKg: 20, speedMs: 1.1, gradePct: -8, terrain: "paved" });
    expect(zero).toBe(283);
    expect(downhill).not.toBeNull();
    expect(downhill!).toBeLessThan(zero!);
  });

  it("returns null for a NaN Pandolf input", () => {
    expect(pandolfWatts({ bodyMassKg: Number.NaN, loadKg: 20, speedMs: 1, gradePct: 0, terrain: "paved" })).toBeNull();
  });
});

describe("load planning", () => {
  it("enforces the hourly and daily water caps", () => {
    const water = waterRequirementLiters({ hours: 24, wbgtC: 35, workRate: "hard" });
    expect(water).toMatchObject({ liters: 12, waterKg: 12 });
    expect(water?.litersPerHour).toBeLessThanOrEqual(1.5);
    expect(water?.note).toMatch(/hyponatremia/i);
  });

  it("flags a 30 percent bodyweight pack as a hard carry", () => {
    expect(packWeightAdvice({ bodyMassKg: 70, packKg: 21 })).toMatchObject({ percentBodyweight: 30, severity: "warning" });
  });

  it("uses the stated backcountry food-energy assumption", () => {
    const calories = calorieRequirement({ bodyMassKg: 70, loadKg: 10, hours: 4, speedMs: 1, gradePct: 0, terrain: "dirt-road" });
    expect(calories?.foodKg).toBeCloseTo(calories!.kcal / 4250, 1);
  });

  it("composes a practical load plan", () => {
    const plan = loadPlan({ bodyMassKg: 70, baseWeightKg: 8, hours: 4, distanceM: 12_000, speedMs: 1, gradePct: 5, terrain: "dirt-road", workRate: "moderate", wbgtC: 29 });
    expect(plan).not.toBeNull();
    expect(plan!.totalPackKg).toBeGreaterThan(plan!.baseWeightKg);
  });
});
