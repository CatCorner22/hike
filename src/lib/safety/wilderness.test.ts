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

  it("warns on rapid gain at altitude", () => {
    const r = amsAssessment({ altitudeM: 3000, gainLastHourM: 450, symptoms: [] });
    expect(r.level).not.toBe("none");
    expect(r.warning).toMatch(/altitude|Higher|fast/i);
  });
});

describe("avalancheTerrainWarning", () => {
  it("warns on steep leeward slopes in winter", () => {
    expect(
      avalancheTerrainWarning({ slopePct: 35, aspectDeg: 180, month: 1, snowOnGround: true }),
    ).toMatch(/avalanche/i);
  });

  it("ignores gentle slopes", () => {
    expect(avalancheTerrainWarning({ slopePct: 20, month: 1 })).toBeNull();
  });

  it("warns on very steep terrain regardless of season", () => {
    expect(avalancheTerrainWarning({ slopePct: 50, month: 7 })).toMatch(/45%|avalanche/i);
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
