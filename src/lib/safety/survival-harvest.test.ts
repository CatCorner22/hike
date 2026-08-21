import { describe, expect, it } from "vitest";
import {
  formatHarvestCard,
  HARVEST_DISCLAIMER,
  survivalHarvestAssessment,
  trappingBasics,
} from "./survival-harvest";

describe("survival harvest", () => {
  it("includes legal disclaimer", () => {
    expect(HARVEST_DISCLAIMER).toMatch(/laws|tags/i);
    const card = formatHarvestCard();
    expect(card).toContain("SURVIVAL HARVEST");
    expect(card).toContain("FIELD DRESSING");
    expect(card).toContain("COOKING");
  });

  it("prioritizes shelter early in a lost scenario", () => {
    expect(survivalHarvestAssessment({ daysLost: 1 })).toMatch(/signal|shelter/i);
  });

  it("covers trapping without promising success", () => {
    expect(trappingBasics().join(" ")).toMatch(/low yield|check traps/i);
  });
});
