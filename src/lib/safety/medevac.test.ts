import { describe, expect, it } from "vitest";
import { nineLineMedevac } from "./medevac";

describe("nineLineMedevac — casualty counts", () => {
  const profile = {
    name: "A Hiker",
    iceName: "Contact",
    icePhone: "5551234567",
    medical: "",
    partySize: 4,
  };

  /**
   * Regression: patient count defaulted to the party size, so an uninjured group of four
   * with one hurt member reported four patients, zero litter, four ambulatory. Rescue
   * resourcing is built from these numbers.
   */
  it("does not report the whole party as casualties", () => {
    const nine = nineLineMedevac({ lat: 37.7, lng: -119.6, profile });
    expect(nine).toMatch(/L3 PATIENTS BY PRECEDENCE: 1B/);
    expect(nine).toMatch(/L5 PATIENTS BY TYPE: 0L 1A/);
    expect(nine).toMatch(/party of 4/);
  });

  it("uses the counts it is given", () => {
    const nine = nineLineMedevac({ lat: 37.7, lng: -119.6, profile, litter: 1, ambulatory: 2, precedence: "A" });
    expect(nine).toMatch(/L3 PATIENTS BY PRECEDENCE: 3A/);
    expect(nine).toMatch(/L5 PATIENTS BY TYPE: 1L 2A/);
  });

  it("reports a single litter casualty as litter, not ambulatory", () => {
    const nine = nineLineMedevac({ lat: 37.7, lng: -119.6, profile, litter: 1 });
    expect(nine).toMatch(/L5 PATIENTS BY TYPE: 1L 0A/);
    expect(nine).toMatch(/L3 PATIENTS BY PRECEDENCE: 1B/);
  });
});
