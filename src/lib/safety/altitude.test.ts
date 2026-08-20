import { describe, expect, it } from "vitest";
import {
  acclimatizationPlan,
  altitudeFromProfile,
  ascentRateAdvice,
  boilingPointC,
  descentImperative,
  expectedSpo2,
  lakeLouiseScore,
  spo2Warning,
} from "./altitude";

describe("Lake Louise AMS score", () => {
  it("requires headache as well as a total score of three", () => {
    const noHeadache = lakeLouiseScore({ headache: 0, giSymptoms: 1, fatigue: 1, dizziness: 1 });
    expect(noHeadache).toMatchObject({ total: 3, hasAms: false, severity: "info" });
  });

  it("reports all three AMS severity bands", () => {
    expect(lakeLouiseScore({ headache: 1, giSymptoms: 1, fatigue: 1, dizziness: 0 })).toMatchObject({
      hasAms: true,
      severity: "caution",
      label: expect.stringMatching(/Mild/),
    });
    expect(lakeLouiseScore({ headache: 2, giSymptoms: 2, fatigue: 2, dizziness: 0 })).toMatchObject({
      severity: "warning",
      label: expect.stringMatching(/Moderate/),
    });
    expect(lakeLouiseScore({ headache: 3, giSymptoms: 3, fatigue: 3, dizziness: 1 })).toMatchObject({
      severity: "critical",
      label: expect.stringMatching(/Severe/),
    });
  });

  it("returns null for an invalid symptom score", () => {
    expect(lakeLouiseScore({ headache: Number.NaN as 0, giSymptoms: 0, fatigue: 0, dizziness: 0 })).toBeNull();
  });
});

describe("altitude emergency and pacing advice", () => {
  it("makes ataxia an immediate descent trigger", () => {
    const result = descentImperative({ hasAtaxia: true, alteredMental: false, breathlessAtRest: false });
    expect(result).toMatchObject({ mustDescend: true, severity: "critical" });
    expect(result.message).toMatch(/DESCEND NOW/);
    expect(result.actions.join(" ")).toMatch(/500–1000 m/);
  });

  it("holds the 500 m/night boundary and warns above it", () => {
    expect(ascentRateAdvice({ currentElevationM: 3500, previousNightElevationM: 3000 })).toMatchObject({
      gainM: 500,
      severity: "info",
    });
    expect(ascentRateAdvice({ currentElevationM: 3501, previousNightElevationM: 3000 })).toMatchObject({
      severity: "warning",
    });
  });

  it("has no ascent-rate concern below 2500 m and rejects NaN", () => {
    expect(ascentRateAdvice({ currentElevationM: 2400, previousNightElevationM: 1800 })).toMatchObject({
      severity: "info",
    });
    expect(ascentRateAdvice({ currentElevationM: Number.NaN, previousNightElevationM: 1800 })).toBeNull();
  });
});

describe("altitude reference calculations", () => {
  it("uses the boiling-point approximation at sea level and 3000 m", () => {
    expect(boilingPointC(0)).toBeCloseTo(100, 1);
    expect(boilingPointC(3000)).toBeCloseTo(89.95, 1);
    expect(boilingPointC(Number.NaN)).toBeNull();
  });

  it("returns a rough expected SpO2 and warns when well below it", () => {
    expect(expectedSpo2(3000)).toBe(92);
    expect(expectedSpo2(Number.NaN)).toBeNull();
    expect(spo2Warning(86, 3000)).toMatch(/well below/);
  });

  it("summarizes altitude exposure from the shared profile shape", () => {
    const summary = altitudeFromProfile([
      { distanceMeters: 0, elevation: 2000 },
      { distanceMeters: 1000, elevation: 3000 },
      { distanceMeters: 2000, elevation: 2800 },
      { distanceMeters: 3000, elevation: 3200 },
    ]);
    expect(summary).toMatchObject({ maxElevationM: 3200, totalGainM: 1400, crosses3000: true });
    expect(summary!.metersAbove2500).toBeCloseTo(2500, 0);
  });

  it("only produces a staged plan above 3000 m", () => {
    expect(acclimatizationPlan(3000)).toEqual([]);
    expect(acclimatizationPlan(4000)).toHaveLength(5);
  });
});
