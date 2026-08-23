import { describe, expect, it } from "vitest";
import {
  amsAssessment,
  avalancheTerrainWarning,
  bearSafetyCard,
  snakeBiteSop,
  wildernessFirstAidCard,
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

  /**
   * The 3 600 m case asserted "severe" on main and is changed here deliberately.
   *
   * PR #38 added the gate above — ordinary symptoms are not AMS without meaningful
   * altitude exposure — but did not touch the severity thresholds, which ran on
   * symptoms *plus* exposure. So a single headache at 3 600 m after a 500 m/hr climb
   * scored 8 and came back "Possible HACE/HAPE ... descend immediately. This is an
   * emergency." A headache at that elevation is the most common altitude symptom there
   * is and is textbook mild AMS; the standard advice is to stop ascending, rest and
   * hydrate. Exposure still escalates it — the fast climb makes it moderate rather than
   * mild — but altitude alone must not manufacture an emergency.
   */
  it("does report altitude-exposed symptoms at a severity the symptoms support", () => {
    expect(amsAssessment({ altitudeM: 3600, gainLastHourM: 500, symptoms: ["headache"] }).level).toBe(
      "moderate",
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

  it("never calls an emergency on altitude alone", () => {
    for (const altitudeM of [2600, 3100, 3600, 4200, 5500]) {
      for (const gainLastHourM of [0, 320, 500, 900]) {
        for (const symptoms of [["headache"], ["nausea"], ["fatigue"], ["headache", "nausea"]] as const) {
          const result = amsAssessment({ altitudeM, gainLastHourM, symptoms: [...symptoms] });
          expect(result.level, `${altitudeM} m +${gainLastHourM} ${symptoms.join("+")}`).not.toBe("severe");
          expect(result.warning ?? "").not.toMatch(/HACE|HAPE/);
        }
      }
    }
  });

  it("escalates by one step for exposure, never three", () => {
    // 1 500 m is below the exposure gate entirely, so compare two exposed altitudes.
    const low = amsAssessment({ altitudeM: 2600, symptoms: ["headache", "nausea"] });
    const high = amsAssessment({ altitudeM: 4200, gainLastHourM: 500, symptoms: ["headache", "nausea"] });
    expect(low.level).toBe("mild");
    expect(high.level).toBe("moderate");
  });

  /** Ataxia is what makes it HACE; HAPE needs breathlessness at rest, which is not an input here. */
  it("reserves the HACE wording for ataxia and still descends on a heavy symptom load", () => {
    const hace = amsAssessment({ altitudeM: 3000, symptoms: ["headache", "ataxia"] });
    expect(hace.level).toBe("severe");
    expect(hace.warning).toMatch(/HACE/);
    expect(hace.warning).toMatch(/emergency/i);

    const heavy = amsAssessment({
      altitudeM: 3000,
      symptoms: ["headache", "nausea", "dizziness", "insomnia", "fatigue"],
    });
    expect(heavy.level).toBe("severe");
    expect(heavy.warning).toMatch(/descend now/i);
    expect(heavy.warning).not.toMatch(/HACE|HAPE/);
    // It must still tell them what would make it one.
    expect(heavy.actions.join(" ")).toMatch(/HACE\/HAPE/);
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

  it("gives lay rescuers action-first CPR guidance without a pulse check", () => {
    const card = wildernessFirstAidCard().join(" ");

    expect(card).toMatch(/check responsiveness/i);
    expect(card).toMatch(/not breathing normally or only gasping/i);
    expect(card).toMatch(/call 911/i);
    expect(card).toMatch(/AED/i);
    expect(card).toMatch(/100–120\/min/i);
    expect(card).toMatch(/hands-only CPR if untrained or unwilling/i);
    expect(card).toMatch(/30 compressions and 2 breaths/i);
    expect(card).not.toMatch(/5 compressions|(?:check|feel for|if no) (?:a )?pulse|only if .*trained/i);
  });

  it("differs grizzly vs black bear response", () => {
    const black = wildlifeEncounterSop("bear_black").join(" ");
    const griz = wildlifeEncounterSop("bear_grizzly").join(" ");
    expect(black).toMatch(/fight back/i);
    expect(griz).toMatch(/play dead/i);
  });
});

/**
 * The first-aid card is read as standalone one-liners under stress. The C line used to
 * open with "start CPR now" — unconditioned, which is wrong-harmful for a breathing
 * casualty. CPR is conditioned on unresponsive + not breathing normally, always.
 */
describe("first-aid card CPR conditioning", () => {
  it("never instructs CPR without the responsiveness/breathing condition", () => {
    const cpr = wildernessFirstAidCard().find((line) => /CPR/.test(line)) ?? "";
    expect(cpr).toMatch(/if unresponsive and not breathing normally/i);
    expect(cpr).not.toMatch(/^C — Circulation: start CPR now/);
    expect(cpr).toMatch(/Do not start CPR on someone who is breathing normally/);
  });
});

/**
 * `slopeFromProfile` returns a signed grade; the sign-blind `< 25` comparison
 * silenced the avalanche warning on every descent — the classic trigger case, with
 * the runout below you. Judged on magnitude now, like slopeWarning beside it.
 */
describe("avalancheTerrainWarning on descents", () => {
  it("warns the same for a descent as for the equivalent climb", () => {
    const climb = avalancheTerrainWarning({ slopePct: 40, month: 1, snowOnGround: true });
    const descent = avalancheTerrainWarning({ slopePct: -40, month: 1, snowOnGround: true });
    expect(climb).not.toBeNull();
    expect(descent).toEqual(climb);
    expect(avalancheTerrainWarning({ slopePct: -50 })).toMatch(/avalanche terrain/);
  });

  it("keeps the quiet band and rejects non-finite grades", () => {
    expect(avalancheTerrainWarning({ slopePct: -20 })).toBeNull();
    expect(avalancheTerrainWarning({ slopePct: Number.NaN })).toBeNull();
  });
});
