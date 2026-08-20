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
    expect(noHeadache).toMatchObject({ total: 3, hasAms: false });
    expect(noHeadache!.label).toMatch(/Does not meet AMS/);
  });

  // A heavy non-headache symptom load is correctly "not AMS" by the 2018 criteria, but
  // reporting it as "info" ranked it below a hydration nag in the warning stack.
  it("still flags a significant non-headache symptom load", () => {
    expect(lakeLouiseScore({ headache: 0, giSymptoms: 3, fatigue: 3, dizziness: 3 })).toMatchObject({
      hasAms: false,
      severity: "caution",
    });
    expect(lakeLouiseScore({ headache: 0, giSymptoms: 1, fatigue: 0, dizziness: 0 })).toMatchObject({
      hasAms: false,
      severity: "info",
    });
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
    // Was "info". Deliberately raised to "caution": with "info" here, severity
    // FELL as the hiker climbed past 3000 m (caution at exactly 3000, info just
    // above), so gaining altitude made the app less concerned. The boundary
    // behaviour this test exists to pin -- 500 m compliant, 501 m a warning --
    // is unchanged.
    expect(ascentRateAdvice({ currentElevationM: 3500, previousNightElevationM: 3000 })).toMatchObject({
      gainM: 500,
      severity: "caution",
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

describe("altitudeFromProfile — input validity", () => {
  // Regression: a single sample was accepted as a profile and reported
  // `crosses3000: true` from one reading, with no distance to integrate.
  it("rejects a single sample", () => {
    expect(altitudeFromProfile([{ distanceMeters: 0, elevation: 3200 }])).toBeNull();
    expect(altitudeFromProfile([])).toBeNull();
  });

  it("measures exposure across a real profile", () => {
    const summary = altitudeFromProfile([
      { distanceMeters: 0, elevation: 2000 },
      { distanceMeters: 1000, elevation: 3000 },
      { distanceMeters: 2000, elevation: 2400 },
    ])!;
    expect(summary.maxElevationM).toBe(3000);
    expect(summary.totalGainM).toBe(1000);
    expect(summary.crosses3000).toBe(true);
    expect(summary.metersAbove2500).toBeGreaterThan(0);
  });
});

/**
 * Severity must never fall as elevation rises. Crossing above 3000 m with a
 * compliant sleeping gain used to drop from "caution" to "info", so a hiker who
 * climbed one metre saw the app become less concerned about altitude.
 */
describe("ascentRateAdvice severity is monotonic in elevation", () => {
  const rank = { info: 0, caution: 1, warning: 2, critical: 3 } as const;

  it("never decreases as current elevation increases", () => {
    for (const gain of [0, 100, 200, 400, 500, 600, 900]) {
      let worst = -1;
      for (let elevation = 2000; elevation <= 5000; elevation += 50) {
        const result = ascentRateAdvice({
          currentElevationM: elevation,
          previousNightElevationM: elevation - gain,
        });
        if (!result) continue;
        const current = rank[result.severity as keyof typeof rank];
        expect(
          current,
          `severity dropped to ${result.severity} at ${elevation} m with gain ${gain} m`,
        ).toBeGreaterThanOrEqual(worst);
        worst = current;
      }
    }
  });

  it("does not become less concerned one metre above 3000 m", () => {
    const at = ascentRateAdvice({ currentElevationM: 3000, previousNightElevationM: 2800 });
    const above = ascentRateAdvice({ currentElevationM: 3001, previousNightElevationM: 2801 });
    expect(rank[above!.severity as keyof typeof rank]).toBeGreaterThanOrEqual(
      rank[at!.severity as keyof typeof rank],
    );
  });
});
