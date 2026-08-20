import { describe, expect, it } from "vitest";
import {
  alptruthChecklist,
  avalancheAssessment,
  avalancheDangerScale,
  avalancheTerrainRisk,
  slopeAngleDegrees,
  slopeAnglesFromProfile,
} from "./avalanche";

describe("avalanche terrain screening", () => {
  it("calculates slope angle and rejects NaN inputs", () => {
    expect(slopeAngleDegrees(100, 100)).toBeCloseTo(45, 1);
    expect(slopeAngleDegrees(Number.NaN, 100)).toBeNull();
    expect(slopeAngleDegrees(100, Number.NaN)).toBeNull();
  });

  it("uses inclusive 30–45 degree avalanche-starting band boundaries", () => {
    expect(avalancheTerrainRisk(29)).toMatchObject({ severity: "caution" });
    expect(avalancheTerrainRisk(30)).toMatchObject({ severity: "warning" });
    expect(avalancheTerrainRisk(45)).toMatchObject({ severity: "warning" });
    expect(avalancheTerrainRisk(46)).toMatchObject({ severity: "warning" });
  });

  it("calls out runout risk below 25 degrees and rejects invalid angles", () => {
    expect(avalancheTerrainRisk(20)?.message).toMatch(/runout zones/);
    expect(avalancheTerrainRisk(Number.NaN)).toBeNull();
  });

  it("finds the steepest sustained along-track gradient", () => {
    const result = slopeAnglesFromProfile(
      [
        { distanceMeters: 0, elevation: 2000 },
        { distanceMeters: 100, elevation: 2100 },
        { distanceMeters: 200, elevation: 2100 },
      ],
      100,
    );
    expect(result).toMatchObject({ maxAngleDeg: 45, atMeters: 50 });
    expect(slopeAnglesFromProfile([{ distanceMeters: 0, elevation: 0 }, { distanceMeters: 100, elevation: Number.NaN }])).toBeNull();
  });
});

describe("avalanche decision aids", () => {
  it("returns the complete five-level public danger scale", () => {
    const scale = avalancheDangerScale();
    expect(scale.map((entry) => entry.level)).toEqual(["low", "moderate", "considerable", "high", "extreme"]);
    expect(scale[3].travelAdvice).toMatch(/Avoid avalanche terrain/);
  });

  it("lists the seven ALPTRUTh factors and applies the three-yes turn-around threshold", () => {
    expect(alptruthChecklist()).toHaveLength(7);
    const result = avalancheAssessment({ alptruthYesCount: 3 });
    expect(result).toMatchObject({ snowGoNoGo: "no-go", severity: "warning" });
    expect(result!.reasons.join(" ")).toMatch(/3-or-more/);
  });

  it("rejects an invalid ALPTRUTh count", () => {
    expect(avalancheAssessment({ alptruthYesCount: Number.NaN })).toBeNull();
  });

  it("makes high danger a no-go and retains a cautious outcome for moderate danger", () => {
    expect(avalancheAssessment({ danger: "high", alptruthYesCount: 0 })).toMatchObject({
      snowGoNoGo: "no-go",
      severity: "critical",
    });
    expect(avalancheAssessment({ danger: "moderate", alptruthYesCount: 0 })).toMatchObject({
      snowGoNoGo: "caution",
      severity: "caution",
    });
  });
});

describe("avalancheAssessment — severity monotonicity", () => {
  const RANK: Record<string, number> = { info: 0, caution: 1, warning: 2, critical: 3 };

  /**
   * Regression: every factor after the first used `severity === "info" ? x : severity`,
   * so it could only ever raise severity *from* info. Entering one ALPTRUTh yes on a
   * "considerable" day therefore reported "caution" where entering none reported
   * "warning" — adding a risk factor made the assessment look safer.
   */
  it("never lowers severity when a risk factor is added", () => {
    for (const danger of ["moderate", "considerable", "high", "extreme"] as const) {
      let previous = 0;
      for (const alptruthYesCount of [0, 1, 2, 3, 4]) {
        const result = avalancheAssessment({ danger, alptruthYesCount })!;
        expect(RANK[result.severity], `${danger} / ${alptruthYesCount} yes`).toBeGreaterThanOrEqual(previous);
        previous = RANK[result.severity];
      }
    }
  });

  it("compounds factors instead of masking them", () => {
    const loaded = avalancheAssessment({
      alptruthYesCount: 1,
      maxSlopeAngleDeg: 38,
      recentSnowCm: 60,
      rapidWarming: true,
    })!;
    expect(RANK[loaded.severity]).toBeGreaterThanOrEqual(RANK.warning);
  });

  it("keeps every added factor at least as severe as the plain danger rating", () => {
    const plain = avalancheAssessment({ danger: "considerable", alptruthYesCount: 0 })!;
    for (const extra of [{ recentSnowCm: 40 }, { rapidWarming: true }, { maxSlopeAngleDeg: 38 }]) {
      const withExtra = avalancheAssessment({ danger: "considerable", alptruthYesCount: 1, ...extra })!;
      expect(RANK[withExtra.severity]).toBeGreaterThanOrEqual(RANK[plain.severity]);
    }
  });
});

describe("avalancheTerrainRisk — steep terrain", () => {
  // Regression: above 50 deg the severity dropped back to "caution", rating a 55 deg
  // slope as less serious than the 35-45 deg band it sits above.
  it("never rates steeper terrain as less severe", () => {
    const RANK: Record<string, number> = { info: 0, caution: 1, warning: 2, critical: 3 };
    let previous = 0;
    for (let angle = 0; angle <= 90; angle += 2) {
      const risk = avalancheTerrainRisk(angle)!;
      expect(RANK[risk.severity], `${angle} deg`).toBeGreaterThanOrEqual(previous);
      previous = RANK[risk.severity];
    }
  });
});
