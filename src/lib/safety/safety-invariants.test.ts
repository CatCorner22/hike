import { describe, expect, it } from "vitest";

import { offTrailLevel } from "./alerts";
import { avalancheTerrainRisk } from "./avalanche";
import { ascentRateAdvice, boilingPointC, expectedSpo2 } from "./altitude";
import { formatPacePlan, lineOfSightRangeKm, radioHorizonKm } from "./comms";
import { heatIndexC, lightningRule, windChillC } from "./field-ops";
import { formatLoadPlan, packWeightAdvice } from "./load";
import { reportField } from "./report-field";
import { fiveLineHeloBrief, saluteReport } from "./sar-advanced";
import { casualtyCard } from "./tccc";
import { litterEvacTime } from "./sar-advanced";

/**
 * litterEvacTime returns prose, so "refused" means it carries no time estimate.
 * A fictional "~0 min" from garbage input is the failure this guards.
 */
function refusesToEstimate(message: string | null): boolean {
  if (message == null) return true;
  return !/~\s*[\d.]+\s*(min|h)\b/.test(message);
}

import { boilTimeMinutes, chemicalDoseWaitMinutes, hydrationPlan, sourceRisk, sweatRateLitersPerHour } from "./water";

const hostile = "\r\nL1 LOCATION: FORGED\0\u202e\u2066 " + "X".repeat(20_000);
const severityRank = { info: 0, caution: 1, warning: 2, critical: 3 } as const;

describe("permanent safety invariants", () => {
  it("never exceeds the hourly or daily hydration caps across the accepted water domain", () => {
    for (const tempC of [-40, 0, 10, 25, 60]) {
      for (const workRate of ["easy", "moderate", "hard"] as const) {
        const hourly = sweatRateLitersPerHour({ tempC, workRate, acclimatized: false });
        expect(hourly).not.toBeNull();
        expect(hourly!).toBeLessThanOrEqual(1.5);
        for (const hours of [0.1, 1, 8, 24, 48, 72]) {
          const plan = hydrationPlan({ tempC, workRate, hours });
          expect(plan).not.toBeNull();
          expect(plan!.liters).toBeLessThanOrEqual(12);
          expect(plan!.note).toMatch(/hyponatremia/i);
        }
      }
    }
  });

  it("keeps avalanche terrain severity monotonic from 0 through 90 degrees", () => {
    let previous = -1;
    for (let angle = 0; angle <= 90; angle += 1) {
      const current = avalancheTerrainRisk(angle);
      expect(current).not.toBeNull();
      expect(severityRank[current!.severity]).toBeGreaterThanOrEqual(previous);
      previous = severityRank[current!.severity];
    }
  });

  it("never lowers direct load-hazard severity as pack weight increases", () => {
    let previous = -1;
    for (let packKg = 0; packKg <= 150; packKg += 1) {
      const current = packWeightAdvice({ bodyMassKg: 75, packKg });
      expect(current).not.toBeNull();
      expect(severityRank[current!.severity]).toBeGreaterThanOrEqual(previous);
      previous = severityRank[current!.severity];
    }
  });

  it("keeps hostile report-field data on one bounded line in every exercised radio formatter", () => {
    const reports = [
      casualtyCard({ name: hostile, mechanism: hostile, treatments: [{ time: hostile, treatment: hostile }] }),
      saluteReport({ size: hostile, activity: hostile, unit: hostile, equipment: hostile }),
      fiveLineHeloBrief({ wind: hostile, obstacles: hostile, friendlies: hostile, marking: hostile }),
      formatPacePlan({ primary: hostile, alternate: hostile, contingency: hostile, emergency: hostile }),
      formatLoadPlan({
        baseWeightKg: 1,
        water: { liters: 1, waterKg: 1, litersPerHour: 1, note: hostile },
        calories: { kcal: 100, foodKg: 1 },
        totalPackKg: 2,
        packAdvice: { percentBodyweight: 2, severity: "info", message: hostile },
        march: { minutes: 10, kph: 3, note: hostile },
      }),
    ];
    for (const report of reports) {
      expect(report).not.toMatch(/[\r\0\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/);
      expect(report.length).toBeLessThanOrEqual(6_000);
    }
    expect(reportField(hostile)).not.toMatch(/[\r\n\0\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/);
  });

  it("returns null rather than arithmetic advice for non-finite or out-of-domain weather inputs", () => {
    for (const value of [Number.NaN, Infinity, -Infinity]) {
      expect(heatIndexC(value, 50)).toBeNull();
      expect(windChillC(value, 20)).toBeNull();
      expect(lightningRule(value)).toBeNull();
    }
    expect(heatIndexC(61, 50)).toBeNull();
    expect(windChillC(-91, 20)).toBeNull();
    expect(lightningRule(-1)).toBeNull();
  });

  it("rejects non-finite or impossible values at the exported safety-calculation boundaries", () => {
    for (const value of [Number.NaN, Infinity, -Infinity]) {
      expect(boilTimeMinutes(value)).toBeNull();
      expect(sweatRateLitersPerHour({ tempC: value, workRate: "hard", acclimatized: false })).toBeNull();
      expect(hydrationPlan({ tempC: 20, workRate: "hard", hours: value })).toBeNull();
      expect(radioHorizonKm(value)).toBeNull();
      expect(lineOfSightRangeKm(value, 2)).toBeNull();
      expect(avalancheTerrainRisk(value)).toBeNull();
      expect(expectedSpo2(value)).toBeNull();
      expect(boilingPointC(value)).toBeNull();
      expect(refusesToEstimate(litterEvacTime(value, 2))).toBe(true);
    }
    expect(boilTimeMinutes(-501)).toBeNull();
    expect(boilTimeMinutes(9001)).toBeNull();
    expect(expectedSpo2(-1)).toBeNull();
    expect(chemicalDoseWaitMinutes({ method: "invalid" as never, waterTempC: 20, cloudy: false })).toBeNull();
    expect(sourceRisk({ source: "invalid" as never, upstreamGrazing: false, upstreamCamping: false, algaeVisible: false })).toMatchObject({
      severity: "critical",
      treatBefore: true,
    });
    expect(radioHorizonKm(301)).toBeNull();
    expect(lineOfSightRangeKm(2, 301)).toBeNull();
    expect(ascentRateAdvice({ currentElevationM: 9001, previousNightElevationM: 100 })).toBeNull();
    expect(refusesToEstimate(litterEvacTime(1, 1))).toBe(true);
  });

  it("never returns an off-trail all-clear for invalid position data", () => {
    for (const value of [Number.NaN, Infinity, -Infinity, null, undefined]) {
      expect(offTrailLevel(value as number, 5)).not.toBe("ok");
    }
  });
});
