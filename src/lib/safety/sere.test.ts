import { describe, expect, it } from "vitest";
import {
  sereAssessment,
  sereQuickCard,
  sereRuleOfThrees,
  sereSections,
  sereStayPutCard,
} from "./sere";

describe("SERE wilderness card", () => {
  it("lists four pillars", () => {
    const sections = sereSections();
    expect(sections.map((s) => s.pillar)).toEqual(["survival", "evasion", "recovery", "escape"]);
    expect(sections.every((s) => s.bullets.length >= 5)).toBe(true);
  });

  it("includes rule of threes", () => {
    expect(sereRuleOfThrees().join(" ")).toMatch(/3 days without water/);
  });

  it("builds a copyable quick card", () => {
    const card = sereQuickCard({ isDark: true });
    expect(card).toContain("WILDERNESS SERE CARD");
    expect(card).toContain("SURVIVAL");
    expect(card).toContain("NIGHT PRIORITIES");
    expect(card).toContain("STAY PUT");
  });

  it("flags night and long stops in assessment", () => {
    expect(sereAssessment({ isDark: true })).toMatch(/shelter/i);
    expect(sereAssessment({ stationaryMin: 35, hasSignal: false })).toMatch(/whistle/);
    expect(sereAssessment({})).toBeNull();
  });

  it("stay-put card matches lost-procedure spirit", () => {
    expect(sereStayPutCard()[0]).toMatch(/STOP/);
  });
});

/**
 * The downstream-travel line used to read inverted — "follow downstream only if cliffs
 * and waterfalls are likely" — advising travel into exactly the terrain that traps and
 * kills lost hikers. Doctrine: drainages can lead toward civilization in gentle
 * terrain; in steep or canyon country they cliff out. The card must never suggest
 * entering cliff/waterfall terrain.
 */
describe("escape card downstream-travel doctrine", () => {
  it("warns against drainages in steep terrain instead of recommending them", () => {
    const escape = sereSections().find((pillar) => pillar.pillar === "escape");
    const line = escape?.bullets.find((bullet) => /downstream/i.test(bullet)) ?? "";
    expect(line).toMatch(/NOT in steep|not.*steep/i);
    expect(line).toMatch(/cliff/i);
    expect(line).not.toMatch(/only if cliffs and waterfalls are likely/);
  });

  it("routes injury care to the canonical MARCH-PAWS sequence", () => {
    const recovery = sereSections().find((pillar) => pillar.pillar === "recovery");
    expect(recovery?.bullets.join(" ")).toMatch(/MARCH-PAWS/);
  });
});
