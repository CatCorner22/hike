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

  it("does not delay CPR for an untrained lay rescuer in severe hypothermia", () => {
    const result = hypothermiaStage({
      coreTempC: 27,
      shivering: false,
      alteredMental: true,
      conscious: false,
    });
    const actions = result?.actions.join(" ") ?? "";

    expect(actions).toMatch(/check responsiveness and normal breathing/i);
    expect(actions).toMatch(/not breathing normally or only gasping/i);
    expect(actions).toMatch(/call 911/i);
    expect(actions).toMatch(/AED/i);
    expect(actions).toMatch(/100–120\/min/i);
    expect(actions).toMatch(/hands-only CPR if untrained or unwilling/i);
    expect(actions).toMatch(/30 compressions and 2 breaths/i);
    expect(actions).not.toMatch(/(?:check|feel for|if no) (?:a )?pulse|only if .*trained/i);
  });

  it("returns null for a NaN core temperature", () => {
    expect(hypothermiaStage({ coreTempC: Number.NaN, shivering: true, alteredMental: false, conscious: true })).toBeNull();
  });
});

describe("hypothermiaStage — false positives", () => {
  // Regression: `!shivering` alone marked every warm, comfortable person "moderate
  // hypothermia", and the "none" stage was unreachable for any input.
  it("does not stage a well, warm, non-shivering person as hypothermic", () => {
    const r = hypothermiaStage({ shivering: false, alteredMental: false, conscious: true });
    expect(r!.stage).toBe("none");
    expect(r!.severity).toBe("info");
  });

  it("counts stopped shivering only for someone actually cold", () => {
    expect(
      hypothermiaStage({ shivering: false, alteredMental: false, conscious: true, coldExposed: true })!.stage,
    ).toBe("moderate");
    expect(
      hypothermiaStage({ shivering: true, alteredMental: false, conscious: true, coldExposed: true })!.stage,
    ).toBe("mild");
  });

  it("still stages on core temperature and mental status alone", () => {
    expect(hypothermiaStage({ coreTempC: 27, shivering: false, alteredMental: false, conscious: true })!.stage).toBe("severe");
    expect(hypothermiaStage({ coreTempC: 31, shivering: true, alteredMental: false, conscious: true })!.stage).toBe("moderate");
    expect(hypothermiaStage({ coreTempC: 34, shivering: true, alteredMental: false, conscious: true })!.stage).toBe("mild");
    expect(hypothermiaStage({ shivering: true, alteredMental: false, conscious: false })!.stage).toBe("severe");
  });
});

describe("estimateWbgtC — ISO 7243 weighting", () => {
  // Regression: the globe and air weights were transposed (0.2*air + 0.1*globe), which
  // under-read WBGT in sun by 0.5 C and could drop a whole heat category at a boundary.
  it("weights the globe temperature at 0.2 and air at 0.1 in sun", () => {
    for (const tempC of [25, 30, 35]) {
      const sun = estimateWbgtC({ tempC, rhPct: 50, inSun: true })!;
      const shade = estimateWbgtC({ tempC, rhPct: 50, inSun: false })!;
      // Black globes in full sun with light wind run 10-20 C over air (Liljegren 2008);
      // globe = air + 15, so sun - shade = 0.2*15 = 3.0. The old +5 C globe put the sun
      // increment at 1.0 C — 1-2 whole categories low in black-flag conditions.
      expect(sun - shade, `${tempC} C`).toBeCloseTo(3.0, 5);
    }
  });

  it("never reports a lower WBGT in sun than in shade", () => {
    for (const tempC of [0, 15, 30, 45]) {
      for (const rhPct of [10, 50, 90]) {
        expect(estimateWbgtC({ tempC, rhPct, inSun: true })!).toBeGreaterThan(
          estimateWbgtC({ tempC, rhPct, inSun: false })!,
        );
      }
    }
  });
});

/**
 * Saturated air is the most dangerous humidity — heat doctrine has no exemption for it.
 * At RH 100 the wet bulb IS the dry bulb; no regression needed, so the Stull domain
 * limit must not silently delete all heat guidance there.
 */
describe("estimateWbgtC at the humidity extremes", () => {
  it("answers at RH 100 with the saturated wet bulb", () => {
    expect(estimateWbgtC({ tempC: 30, rhPct: 100, inSun: false })).toBeCloseTo(30, 1);
    expect(estimateWbgtC({ tempC: 35, rhPct: 100, inSun: true })).not.toBeNull();
  });

  it("stays monotone in RH through the cold-dry corner Stull excludes", () => {
    const drier = estimateWbgtC({ tempC: -15, rhPct: 5, inSun: false })!;
    const damper = estimateWbgtC({ tempC: -15, rhPct: 10, inSun: false })!;
    expect(drier).toBeLessThanOrEqual(damper);
  });
});

/**
 * ICAR HT1: conscious + shivering = mild hypothermia. Active shivering is itself
 * evidence of cold stress and needs no coldExposed corroboration — only STOPPED
 * shivering is ambiguous. The old gate returned "no hypothermia signs were supplied"
 * for an actively shivering patient.
 */
describe("hypothermiaStage on active shivering alone", () => {
  it("stages an unflagged shivering patient as mild, not none", () => {
    const staged = hypothermiaStage({ shivering: true, alteredMental: false, conscious: true });
    expect(staged?.stage).toBe("mild");
  });

  it("still requires corroboration for stopped shivering, and none stays reachable", () => {
    expect(hypothermiaStage({ shivering: false, alteredMental: false, conscious: true })?.stage).toBe("none");
    expect(hypothermiaStage({ shivering: false, alteredMental: false, conscious: true, coldExposed: true })?.stage).toBe("moderate");
  });
});
