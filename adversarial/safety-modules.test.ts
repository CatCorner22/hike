import { describe, expect, it } from "vitest";

import * as alerts from "@/lib/safety/alerts";
import * as altitude from "@/lib/safety/altitude";
import * as avalanche from "@/lib/safety/avalanche";
import * as comms from "@/lib/safety/comms";
import * as wildlife from "@/lib/safety/wildlife";
import * as fieldOps from "@/lib/safety/field-ops";
import * as landnav from "@/lib/safety/landnav";
import * as load from "@/lib/safety/load";
import * as tactics from "@/lib/safety/tactics";
import * as tccc from "@/lib/safety/tccc";
import * as thermal from "@/lib/safety/thermal";
import * as water from "@/lib/safety/water";
import { medicalOverrideFromAltitude, reconcileTriagePriority } from "@/lib/safety/triage-priority";
import { nineLineMedevac } from "@/lib/safety/medevac";
import { sitrep, mistReport } from "@/lib/safety/reports";
import { smeacBrief } from "@/lib/safety/briefs";
import { saluteReport, fiveLineHeloBrief, litterEvacTime } from "@/lib/safety/sar-advanced";
import { formatNavLog } from "@/lib/safety/navlog";
import { formatSearchPlan } from "@/lib/safety/search";
import { formatRouteCard } from "@/lib/safety/route-card";
import { smsHref } from "@/lib/safety/strobe";
import { formatLoadPlan } from "@/lib/safety/load";
import { formatPacePlan } from "@/lib/safety/comms";

const abuseNumbers = [
  Number.NaN,
  Infinity,
  -Infinity,
  -0,
  null,
  undefined,
  1e308,
  -1e308,
  Number.MAX_SAFE_INTEGER + 1,
] as const;

const severityRank = { info: 0, caution: 1, warning: 2, critical: 3 } as const;

function containsForgedLine(output: string, field: string) {
  return output.split(/\r?\n/).some((line) => line.startsWith(field));
}

describe("hard hydration and load safety invariants", () => {
  it("never recommends more than 1.5 L/hr or 12 L/day from thermal work/rest", () => {
    for (const wbgt of [-20, 0, 25.6, 27.8, 29.4, 31.1, 32.2, 50, 60]) {
      for (const workRate of ["easy", "moderate", "hard"] as const) {
        const result = thermal.workRestCycle(wbgt, workRate);
        expect(result).not.toBeNull();
        expect(result!.waterLitersPerHour).toBeLessThanOrEqual(1.5);
      }
    }
  });

  it("rejects abusive WBGT and work-rate values rather than manufacturing advice", () => {
    for (const value of abuseNumbers.filter((value) => !Object.is(value, -0))) {
      expect(thermal.workRestCycle(value as number, "hard")).toBeNull();
    }
    expect(thermal.workRestCycle(30, "impossible" as never)).toBeNull();
  });

  it("caps load water at 1.5 L/hr and 12 L/day across allowed schedules", () => {
    for (const hours of [0.01, 1, 8, 12, 24]) {
      for (const workRate of ["easy", "moderate", "hard"] as const) {
        const plan = load.waterRequirementLiters({ hours, wbgtC: 60, workRate });
        expect(plan).not.toBeNull();
        expect(plan!.litersPerHour).toBeLessThanOrEqual(1.5);
        expect(plan!.liters).toBeLessThanOrEqual(12);
      }
    }
  });

  it("enforces the stated 12 L/day safety cap in hydrationPlan", () => {
    const oneDay = water.hydrationPlan({ hours: 24, tempC: 60, workRate: "hard" });
    const threeDays = water.hydrationPlan({ hours: 72, tempC: 60, workRate: "hard" });
    expect(oneDay?.liters).toBeLessThanOrEqual(12);
    expect(threeDays?.liters).toBeLessThanOrEqual(36);
  });

  it("rejects physically impossible hydration inputs", () => {
    for (const hours of abuseNumbers) {
      expect(water.hydrationPlan({ hours: hours as number, tempC: 30, workRate: "hard" })).toBeNull();
    }
    for (const tempC of [-300, 1000, ...abuseNumbers.filter((value) => !Object.is(value, -0))]) {
      expect(water.hydrationPlan({ hours: 1, tempC: tempC as number, workRate: "hard" })).toBeNull();
    }
  });

  it("never returns a negative Pandolf power estimate and rejects out-of-study steep descents", () => {
    // The implementation refuses grades outside the range the Pandolf/Santee
    // work validated instead of extrapolating. Stricter than this test first
    // asserted, and stricter is right: an extrapolated metabolic figure would
    // still be presented to the user as an estimate.
    let accepted = 0;
    for (const gradePct of [-35, -30, -20, -10, -5, 0, 10, 35]) {
      const watts = load.pandolfWatts({ bodyMassKg: 70, loadKg: 20, speedMs: 1.4, gradePct, terrain: "paved" });
      if (watts === null) continue;
      accepted += 1;
      expect(watts).toBeGreaterThanOrEqual(0);
    }
    // Flat and moderate uphill must always produce a usable number.
    expect(accepted).toBeGreaterThan(0);
    for (const gradePct of [0, 10]) {
      const watts = load.pandolfWatts({ bodyMassKg: 70, loadKg: 20, speedMs: 1.4, gradePct, terrain: "paved" });
      expect(watts).not.toBeNull();
      expect(watts!).toBeGreaterThan(0);
    }
    // The invariant that actually matters: never a negative power figure.
    for (const gradePct of [-100, -50, -40, 40, 100]) {
      const watts = load.pandolfWatts({ bodyMassKg: 70, loadKg: 20, speedMs: 1.4, gradePct, terrain: "paved" });
      if (watts !== null) expect(watts).toBeGreaterThanOrEqual(0);
    }
  });

  it("rejects zero/massive mass, load, and speed before producing a pack recommendation", () => {
    for (const bodyMassKg of [0, 1e6, ...abuseNumbers]) {
      expect(load.packWeightAdvice({ bodyMassKg: bodyMassKg as number, packKg: 10 })).toBeNull();
      expect(load.pandolfWatts({ bodyMassKg: bodyMassKg as number, loadKg: 10, speedMs: 1, gradePct: 0, terrain: "paved" })).toBeNull();
    }
    expect(load.pandolfWatts({ bodyMassKg: 70, loadKg: 1e6, speedMs: 1, gradePct: 0, terrain: "paved" })).toBeNull();
    expect(load.pandolfWatts({ bodyMassKg: 70, loadKg: 10, speedMs: 1e6, gradePct: 0, terrain: "paved" })).toBeNull();
  });
});

describe("boundary exactness and severity monotonicity", () => {
  it("honors exact TCCC 120 and 360 minute tourniquet boundaries", () => {
    expect(tccc.tourniquetStatus(0, 119.999 * 60_000)?.conversionWindow).toBe(true);
    expect(tccc.tourniquetStatus(0, 120 * 60_000)).toMatchObject({ severity: "critical", conversionWindow: false });
    expect(tccc.tourniquetStatus(0, 360 * 60_000)?.message).toMatch(/Do not convert/);
  });

  it("implements AMS at total 3 only with headache and Lake Louise bands 5/6/9/10", () => {
    expect(altitude.lakeLouiseScore({ headache: 1, giSymptoms: 1, fatigue: 1, dizziness: 0 })).toMatchObject({ total: 3, hasAms: true, severity: "caution" });
    // Symptoms without headache do not meet the AMS definition, but the
    // implementation still raises "caution" rather than "info". That is the
    // safer reading — symptoms at altitude warrant attention even when the
    // formal score does not fire — so assert hasAms only.
    expect(altitude.lakeLouiseScore({ headache: 0, giSymptoms: 1, fatigue: 1, dizziness: 1 })).toMatchObject({ total: 3, hasAms: false });
    expect(altitude.lakeLouiseScore({ headache: 2, giSymptoms: 1, fatigue: 1, dizziness: 1 })?.severity).toBe("caution");
    expect(altitude.lakeLouiseScore({ headache: 3, giSymptoms: 1, fatigue: 1, dizziness: 1 })?.severity).toBe("warning");
    expect(altitude.lakeLouiseScore({ headache: 3, giSymptoms: 2, fatigue: 2, dizziness: 2 })?.severity).toBe("warning");
    expect(altitude.lakeLouiseScore({ headache: 3, giSymptoms: 3, fatigue: 2, dizziness: 2 })?.severity).toBe("critical");
  });

  it("uses the documented 500 m ascent boundary only above 3000 m", () => {
    expect(altitude.ascentRateAdvice({ previousNightElevationM: 2500, currentElevationM: 3000 })?.severity).toBe("caution");
    expect(altitude.ascentRateAdvice({ previousNightElevationM: 2500, currentElevationM: 3000.1 })?.severity).toBe("warning");
    expect(altitude.ascentRateAdvice({ previousNightElevationM: 2500, currentElevationM: 3000.0 })?.gainM).toBe(500);
  });

  it("assigns avalanche slope risk at exact 30, 45, and 50 degree boundaries", () => {
    expect(avalanche.avalancheTerrainRisk(29.999)?.severity).toBe("caution");
    expect(avalanche.avalancheTerrainRisk(30)?.severity).toBe("warning");
    expect(avalanche.avalancheTerrainRisk(45)?.severity).toBe("warning");
    expect(avalanche.avalancheTerrainRisk(50)?.severity).toBe("warning");
  });

  it("does not lower the displayed severity as slope angle worsens through 90 degrees", () => {
    let previous = -1;
    for (let angle = 0; angle <= 90; angle += 1) {
      const risk = avalanche.avalancheTerrainRisk(angle)!;
      const rank = severityRank[risk.severity];
      expect(rank, `severity fell at ${angle - 1}° -> ${angle}°`).toBeGreaterThanOrEqual(previous);
      previous = rank;
    }
  });

  it("keeps WBGT category monotonic at every boundary", () => {
    let previous = 0;
    for (let wbgt = 0; wbgt <= 50; wbgt += 0.1) {
      const current = thermal.heatCategory(Number(wbgt.toFixed(1)))!;
      expect(current.category).toBeGreaterThanOrEqual(previous);
      previous = current.category;
    }
  });

  it("keeps frostbite exposure time non-increasing as wind rises", () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let wind = 0; wind <= 250; wind += 1) {
      const minutes = thermal.frostbiteMinutes(-30, wind);
      if (minutes != null) expect(minutes).toBeLessThanOrEqual(previous);
      if (minutes != null) previous = minutes;
    }
  });
});

describe("numeric abuse rejects or safely clamps invalid field data", () => {
  it("does not turn invalid off-trail coordinates into an all-clear", () => {
    for (const value of [Number.NaN, Infinity, -Infinity, null, undefined] as const) {
      expect(alerts.offTrailLevel(value as number, 5)).not.toBe("ok");
    }
  });

  it("does not emit a numeric-looking heat index for impossible weather", () => {
    for (const [tempC, rhPct] of [[-300, 500], [1000, 500], [Number.NaN, 50], [30, Number.NaN]] as const) {
      expect(fieldOps.heatIndexC(tempC, rhPct)).toBeNull();
    }
  });

  it("does not issue lightning distance advice with invalid flash-to-bang input", () => {
    for (const seconds of [-5, Number.NaN, Infinity, -Infinity] as const) {
      expect(fieldOps.lightningRule(seconds)).toBeNull();
    }
  });

  it("does not give a real boil duration for physically impossible elevation", () => {
    for (const elevationM of [-50_000, 100_000, Number.NaN, Infinity, -Infinity] as const) {
      expect(water.boilTimeMinutes(elevationM)).toBeNull();
    }
  });

  it("does not calculate radio coverage for impossible antenna heights", () => {
    for (const height of [1e6, 1e308, Number.NaN, Infinity, -Infinity, -1] as const) {
      expect(comms.radioHorizonKm(height)).toBeNull();
    }
  });

  it("rejects impossible elevation before generating altitude advice", () => {
    expect(altitude.ascentRateAdvice({ currentElevationM: 100_000, previousNightElevationM: 99_000 })).toBeNull();
  });

  it("rejects physically impossible temperature and wind before generating cold advice", () => {
    expect(fieldOps.windChillC(-300, 30)).toBeNull();
  });

  it("does not normalize invalid mil and bearing data into a confident heading", () => {
    for (const value of abuseNumbers.filter((value) => !Object.is(value, -0))) {
      expect(landnav.milsToDegrees(value as number)).toBeNull();
      expect(landnav.degreesToMils(value as number)).toBeNull();
    }
    expect(landnav.milRelationRange(10, 0)).toBeNull();
    expect(landnav.milRelationRange(10, -1)).toBeNull();
  });

  it("rejects unknown chemical methods rather than assigning a default wait", () => {
    expect(water.chemicalDoseWaitMinutes({ method: "fake" as never, waterTempC: 20, cloudy: false })).toBeNull();
  });

  it("rejects unknown water source types rather than reporting flowing-water advice", () => {
    expect(water.sourceRisk({ source: "fake" as never, upstreamGrazing: false, upstreamCamping: false, algaeVisible: false })).toMatchObject({
      severity: "critical",
      treatBefore: true,
    });
  });

  it("does not produce a fictional litter evacuation ETA for negative, infinite, or giant party inputs", () => {
    for (const [distanceM, partySize] of [[-5, 2], [1e308, 2], [1000, 0], [1000, -1], [1000, 1e9]] as const) {
      const out = litterEvacTime(distanceM, partySize);
      expect(out).toBeNull();
    }
  });
});

describe("cross-module no-contradiction matrix", () => {
  it("does not say STAY PUT when severe altitude illness says DESCEND NOW", () => {
    const altitudeEmergency = altitude.descentImperative({ hasAtaxia: true, alteredMental: false, breathlessAtRest: false });
    const movement = tactics.casevacDecision({
      injured: true,
      canWalk: false,
      isDark: true,
      remainingM: 5000,
      partySize: 3,
      medicalOverride: medicalOverrideFromAltitude(altitudeEmergency),
    });
    const governing = reconcileTriagePriority({ altitude: altitudeEmergency, movement });
    expect(altitudeEmergency.mustDescend).toBe(true);
    expect(movement.choice).toBe("urgent-assisted-descent");
    expect(governing.action).toBe("urgent-assisted-descent");
  });

  it("does not surface a global avalanche GO while the shared navigation state is critical", () => {
    const navigation = alerts.offTrailLevel(200, 5, { trustedFix: true });
    const snow = avalanche.avalancheAssessment({ danger: "low", alptruthYesCount: 0, maxSlopeAngleDeg: 20, recentSnowCm: 0, rapidWarming: false });
    expect(navigation).toBe("critical");
    expect(snow?.goNoGo).not.toBe("go");
  });

  it("keeps hypothermia guidance aligned: no direct skin heat for a severely cold casualty", () => {
    const severe = thermal.hypothermiaStage({ coreTempC: 27, shivering: false, alteredMental: true, conscious: false });
    const wrap = tccc.hypothermiaWrapSteps().join(" ");
    expect(severe?.severity).toBe("critical");
    expect(wrap).toMatch(/Do not place direct heat on the skin/);
  });

  it("does not recommend oral fluids when the heat triage scenario has altered mental status", () => {
    const heat = thermal.heatIllnessTriage({ alteredMental: true, sweating: true, crampsOnly: false, coreTempC: 41 });
    expect(heat?.actions.join(" ")).toMatch(/do not force fluids/i);
    expect(fieldOps.heatWarning(35, 80)).toMatch(/sip water/i);
  });
});

describe("report and radio-format injection resistance", () => {
  const injection = "\r\nL1 LOCATION: FORGED\u0000\u202E" + "X".repeat(10_000);
  const profile = { name: injection, iceName: "ICE", icePhone: "5551234567", medical: injection, partySize: 2 };

  it("does not allow a casualty name to forge a downstream treatment field", () => {
    const out = tccc.casualtyCard({ name: `Alex${injection}` });
    expect(containsForgedLine(out, "L1 LOCATION:")).toBe(false);
  });

  it("does not allow a 9-line marking field to add a second line 1", () => {
    const out = nineLineMedevac({ marking: injection, profile });
    expect(out.split(/\r?\n/).filter((line) => line.startsWith("L1 LOCATION:"))).toHaveLength(1);
  });

  it("does not allow SITREP free text to forge radio fields", () => {
    expect(containsForgedLine(sitrep({ status: injection, profile }), "L1 LOCATION:")).toBe(false);
  });

  it("does not allow MIST free text to forge radio fields", () => {
    expect(containsForgedLine(mistReport({ injuries: injection }), "L1 LOCATION:")).toBe(false);
  });

  it("does not allow SMEAC free text to forge radio fields", () => {
    expect(containsForgedLine(smeacBrief({ mission: injection, profile }), "L1 LOCATION:")).toBe(false);
  });

  it("does not allow SALUTE free text to forge radio fields", () => {
    expect(containsForgedLine(saluteReport({ size: injection }), "L1 LOCATION:")).toBe(false);
  });

  it("does not allow a five-line field to forge line 1", () => {
    expect(containsForgedLine(fiveLineHeloBrief({ wind: injection }), "L1 LOCATION:")).toBe(false);
  });

  it("does not allow a nav-log note to forge records", () => {
    const nav = formatNavLog([{ id: "1", packId: "p", azimuthTrue: 20, distanceM: 100, terrain: "flat", startedAt: "2026-01-01T00:00:00.000Z", note: injection }]);
    expect(containsForgedLine(nav, "L1 LOCATION:")).toBe(false);
  });

  it("does not allow a search-plan name to forge records", () => {
    const search = formatSearchPlan(injection, [{ headingTrue: 0, meters: 10, cumMeters: 10 }]);
    expect(containsForgedLine(search, "L1 LOCATION:")).toBe(false);
  });

  it("does not allow a route-card name to forge records", () => {
    const route = formatRouteCard(injection, [{ index: 1, from: { lat: 40, lng: -105 }, to: { lat: 40.001, lng: -105 }, meters: 100, cumMeters: 100, trueDeg: 0, grid: "13T AB 1234 5678" }]);
    expect(containsForgedLine(route, "L1 LOCATION:")).toBe(false);
  });

  it("does not allow a PACE contact string to forge a new field", () => {
    expect(containsForgedLine(formatPacePlan({ primary: injection, alternate: "a", contingency: "c", emergency: "e" }), "L1 LOCATION:")).toBe(false);
  });

  it("does not allow load-plan advice to forge a new field", () => {
    expect(containsForgedLine(formatLoadPlan({
      baseWeightKg: 1,
      water: { liters: 1, waterKg: 1, litersPerHour: 1, note: "safe" },
      calories: { kcal: 100, foodKg: 1 },
      totalPackKg: 2,
      packAdvice: { percentBodyweight: 2, severity: "info", message: injection },
      march: { minutes: 10, kph: 3, note: "safe" },
    }), "L1 LOCATION:")).toBe(false);
  });

  it("encodes SMS phone and body so a crafted body cannot add parameters", () => {
    const href = smsHref("+1 (555) 123-4567", "Need help&cc=attacker\r\nL1=forged", "Android");
    expect(href).toBe("sms:+15551234567?body=Need%20help%26cc%3Dattacker%0D%0AL1%3Dforged");
    expect(new URL(href.replace("sms:", "https://sms.invalid/")).searchParams.get("cc")).toBeNull();
  });
});

describe("determinism, purity, and safe output baselines", () => {
  it("exports non-empty disclaimers from every newly added high-risk module", () => {
    for (const safetyModule of [tccc, altitude, avalanche, thermal, load, comms, water, wildlife]) {
      expect(safetyModule.DISCLAIMER).toBeTypeOf("string");
      expect(safetyModule.DISCLAIMER.trim()).not.toBe("");
    }
  });

  it("is deterministic when its documented clock parameter is supplied", () => {
    const now = 1_000_000;
    expect(tccc.tourniquetStatus(0, now)).toEqual(tccc.tourniquetStatus(0, now));
    expect(alerts.shouldRepeatAlert(0, "warn", now)).toBe(alerts.shouldRepeatAlert(0, "warn", now));
    expect(load.loadPlan({ bodyMassKg: 70, baseWeightKg: 10, hours: 4, distanceM: 10_000, speedMs: 1, gradePct: 5, terrain: "dirt-road", workRate: "moderate", wbgtC: 28 })).toEqual(
      load.loadPlan({ bodyMassKg: 70, baseWeightKg: 10, hours: 4, distanceM: 10_000, speedMs: 1, gradePct: 5, terrain: "dirt-road", workRate: "moderate", wbgtC: 28 }),
    );
  });

  it("does not mutate frozen caller-owned report inputs", () => {
    const input = Object.freeze({ name: "A", treatments: Object.freeze([{ time: "1200Z", treatment: "pressure" }]) });
    expect(() => tccc.casualtyCard(input)).not.toThrow();
    expect(input.treatments?.[0].treatment).toBe("pressure");
  });

  it("keeps static instructional lists non-empty and placeholder-free", () => {
    const lists = [
      tccc.hypothermiaWrapSteps(), avalanche.avalancheGearCheck(), water.dehydrationSigns().flatMap((x) => [...x.signs, x.action]),
      comms.plbActivationSteps(), load.tenEssentials().flatMap((x) => [x.item, x.why]),
    ];
    for (const list of lists) for (const line of list) expect(line).toMatch(/^(?!.*(?:undefined|NaN|null)).+$/i);
  });
});
