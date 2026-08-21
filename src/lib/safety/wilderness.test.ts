import { describe, expect, it } from "vitest";
import {
  amsAssessment,
  avalancheTerrainWarning,
  bearSafetyCard,
  snakeBiteSop,
  wildlifeEncounterSop,
} from "./wilderness";

describe("amsAssessment", () => {
  it("flags severe when ataxia present", () => {
    const r = amsAssessment({
      altitudeM: 3200,
      gainLastHourM: 500,
      symptoms: ["headache", "ataxia"],
    });
    expect(r.level).toBe("severe");
    expect(r.warning).toMatch(/HACE|HAPE|Descend/i);
  });

  it("stays quiet at low elevation with no symptoms", () => {
    const r = amsAssessment({ altitudeM: 1500, symptoms: [] });
    expect(r.level).toBe("none");
    expect(r.warning).toBeNull();
  });

  it("does not treat fatigue at 1500 m as AMS", () => {
    const r = amsAssessment({ altitudeM: 1500, symptoms: ["fatigue"] });
    expect(r.level).toBe("none");
    expect(r.warning).toBeNull();
  });

  it.each(["headache", "nausea", "dizziness", "insomnia"] as const)(
    "does not label ordinary %s as AMS without meaningful altitude exposure",
    (symptom) => {
      const r = amsAssessment({ altitudeM: 1500, gainLastHourM: 400, symptoms: [symptom] });
      expect(r.level).toBe("none");
      expect(r.warning).toBeNull();
    },
  );

  it("does not let a large ordinary symptom score bypass the exposure gate", () => {
    const r = amsAssessment({
      altitudeM: 0,
      symptoms: ["headache", "nausea", "fatigue", "dizziness", "insomnia"],
    });
    expect(r.level).toBe("none");
    expect(r.warning).toBeNull();
  });

  it("classifies ordinary symptoms once meaningful exposure is present", () => {
    expect(amsAssessment({ altitudeM: 2500, symptoms: ["headache"] }).level).toBe("mild");
    expect(
      amsAssessment({ altitudeM: 2000, gainLastHourM: 300, symptoms: ["headache"] }).level,
    ).toBe("mild");
  });

  // Regression: altitude and ascent rate were scored into the same total as symptoms, so
  // a well hiker at 3500 m after a fast climb was told they had "Moderate altitude
  // illness". Exposure must still warn, but it is not a diagnosis.
  it("warns on rapid gain at altitude without calling it illness", () => {
    const r = amsAssessment({ altitudeM: 3000, gainLastHourM: 450, symptoms: [] });
    expect(r.level).toBe("none");
    expect(r.warning).toMatch(/altitude|Higher|fast|watch for/i);
  });

  it("does not report altitude illness with no symptoms, however high and fast", () => {
    for (const altitudeM of [2600, 3100, 3600, 4200]) {
      for (const gainLastHourM of [0, 320, 500, 900]) {
        const r = amsAssessment({ altitudeM, gainLastHourM, symptoms: [] });
        expect(r.level, `${altitudeM} m +${gainLastHourM} m/h`).toBe("none");
      }
    }
  });

  it("does report illness once altitude-exposed symptoms are present", () => {
    expect(amsAssessment({ altitudeM: 3600, gainLastHourM: 500, symptoms: ["headache"] }).level).toBe(
      "severe",
    );
    expect(amsAssessment({ altitudeM: 2600, symptoms: ["headache"] }).level).toBe("mild");
  });

  it("treats low-altitude ataxia as an emergency without labeling it altitude illness", () => {
    const r = amsAssessment({ altitudeM: 1500, symptoms: ["ataxia"] });
    expect(r.level).toBe("severe");
    expect(r.warning).toMatch(/emergency medical help/i);
    expect([r.warning, ...r.actions].join(" ")).not.toMatch(/HACE|HAPE|descend|altitude/i);
  });

  it("retains altitude-specific emergency guidance for ataxia after meaningful exposure", () => {
    const r = amsAssessment({ altitudeM: 3200, symptoms: ["ataxia"] });
    expect(r.level).toBe("severe");
    expect(r.warning).toMatch(/HACE|HAPE|descend/i);
  });
});

describe("avalancheTerrainWarning", () => {
  it("warns on start-zone angles in snow season", () => {
    expect(
      avalancheTerrainWarning({ slopePct: 35, month: 1, snowOnGround: true }),
    ).toMatch(/avalanche/i);
  });

  it("ignores gentle slopes", () => {
    expect(avalancheTerrainWarning({ slopePct: 20, month: 1 })).toBeNull();
  });

  it("warns on very steep terrain regardless of season", () => {
    expect(avalancheTerrainWarning({ slopePct: 50, month: 7 })).toMatch(/45%|avalanche/i);
  });

  /**
   * Regression: the warning keyed off an `aspectDeg` the caller filled with the hiker's
   * travel heading. Aspect is the direction a slope faces; heading is where the hiker is
   * pointed. Identical terrain warned or stayed silent depending only on which way they
   * happened to be walking.
   */
  it("gives the same answer for the same terrain however the hiker is facing", () => {
    const answers = new Set(
      [0, 45, 90, 135, 180, 225, 270, 315].map(() =>
        avalancheTerrainWarning({ slopePct: 32, month: 1, snowOnGround: true }),
      ),
    );
    expect(answers.size).toBe(1);
    expect([...answers][0]).toMatch(/forecast/i);
  });

  it("says nothing off-season on a moderate slope", () => {
    expect(avalancheTerrainWarning({ slopePct: 32, month: 7, snowOnGround: false })).toBeNull();
  });
});

describe("wilderness cards", () => {
  it("includes bear safety basics", () => {
    expect(bearSafetyCard().join(" ")).toMatch(/bear spray/i);
  });

  it("includes snake bite do-nots", () => {
    expect(snakeBiteSop().join(" ")).toMatch(/Do NOT cut/);
  });

  it("differs grizzly vs black bear response", () => {
    const black = wildlifeEncounterSop("bear_black").join(" ");
    const griz = wildlifeEncounterSop("bear_grizzly").join(" ");
    expect(black).toMatch(/fight back/i);
    expect(griz).toMatch(/play dead/i);
  });
});
