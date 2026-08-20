import { describe, expect, it } from "vitest";
import {
  TERRAIN_FACTORS,
  calorieRequirement,
  loadPlan,
  packWeightAdvice,
  pandolfKcalPerHour,
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

describe("pandolfWatts — physiological plausibility", () => {
  /**
   * Regression: Pandolf grows without bound outside its study conditions. 2.5 m/s in
   * 35 cm of snow up a 35% grade returned ~23,000 W (~20,000 kcal/h), which loadPlan
   * turned into 30 kg of food and a pack at 120% of body weight, presented as a plan.
   */
  it("refuses to report an extrapolation as an estimate", () => {
    expect(
      pandolfWatts({ bodyMassKg: 95, loadKg: 45, speedMs: 2.5, gradePct: 35, terrain: "snow-35cm" }),
    ).toBeNull();
    expect(
      loadPlan({
        bodyMassKg: 70, baseWeightKg: 45, hours: 8, distanceM: 20000,
        speedMs: 2.5, gradePct: 35, terrain: "snow-35cm", workRate: "hard",
      }),
    ).toBeNull();
  });

  it("never returns a negative or implausible figure anywhere in its accepted domain", () => {
    for (const bodyMassKg of [50, 70, 95]) {
      for (const loadKg of [0, 10, 25, 45]) {
        for (const speedMs of [0.5, 1.0, 1.4, 2.0, 2.5]) {
          for (const gradePct of [-35, -20, -10, 0, 10, 20, 35]) {
            for (const terrain of ["paved", "light-brush", "heavy-brush", "snow-35cm"] as const) {
              const watts = pandolfWatts({ bodyMassKg, loadKg, speedMs, gradePct, terrain });
              if (watts == null) continue;
              expect(watts, `${bodyMassKg}kg ${loadKg}kg ${speedMs}m/s ${gradePct}% ${terrain}`).toBeGreaterThan(0);
              expect(watts).toBeLessThanOrEqual(1400);
            }
          }
        }
      }
    }
  });

  it("still answers for ordinary hiking", () => {
    const kcal = pandolfKcalPerHour({ bodyMassKg: 70, loadKg: 12, speedMs: 1.1, gradePct: 10, terrain: "light-brush" });
    expect(kcal).not.toBeNull();
    expect(kcal!).toBeGreaterThan(200);
    expect(kcal!).toBeLessThan(1200);
  });
});
