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
