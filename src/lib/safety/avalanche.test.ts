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
