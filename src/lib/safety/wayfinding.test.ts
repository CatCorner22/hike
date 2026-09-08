import { describe, expect, it } from "vitest";
import {
  backstopChecklist,
  formatWayfindingCard,
  wayfindingAssessment,
  wayfindingTechniques,
} from "./wayfinding";

describe("wayfinding and backstops", () => {
  it("lists core techniques", () => {
    const ids = wayfindingTechniques().map((t) => t.id);
    expect(ids).toContain("handrail");
    expect(ids).toContain("backtrack");
    expect(ids).toContain("aiming-off");
  });

  it("warns when off trail without backstop", () => {
    expect(wayfindingAssessment({ offTrail: true, hasBackstop: false })).toMatch(/backstop/i);
    expect(wayfindingAssessment({ offTrail: true, hasBackstop: true })).toBeNull();
  });

  it("formats a card with backstop checklist", () => {
    const card = formatWayfindingCard("Half Dome");
    expect(card).toContain("WAYFINDING");
    expect(card).toContain("BACKSTOP");
    expect(backstopChecklist().length).toBeGreaterThan(3);
  });
});
