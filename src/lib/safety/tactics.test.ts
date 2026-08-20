import { describe, expect, it } from "vitest";
import {
  casevacDecision,
  gridConvergence,
  lostPersonQuery,
  paceBeads,
  polarisHint,
  watchMethodHeading,
} from "./tactics";
import { reconcileTriagePriority } from "./triage-priority";

describe("tactics", () => {
  it("gives a northern watch-method hint", () => {
    const w = watchMethodHeading(15, "north");
    expect(w).not.toBeNull();
    expect(w!.toward).toBe("S");
    expect(w!.hint).toMatch(/south/i);
  });

  it("uses Polaris at mid-latitudes", () => {
    expect(polarisHint(37)).toMatch(/37/);
    expect(polarisHint(-40)).toMatch(/Southern Cross/);
  });

  it("computes a small Sierra grid convergence", () => {
    const g = gridConvergence(37.7, -119.6);
    expect(g).not.toBeNull();
    expect(Math.abs(g!)).toBeLessThan(4);
  });

  it("keeps a non-walker in place", () => {
    expect(casevacDecision({ injured: true, canWalk: false, isDark: false }).choice).toBe("stay");
    expect(casevacDecision({ injured: false, canWalk: true, isDark: false, remainingM: 400, partySize: 2 }).choice).toBe(
      "walk-out",
    );
  });

  it("overrides generic stay-put advice for a time-critical medical evacuation", () => {
    const decision = casevacDecision({
      injured: true,
      canWalk: false,
      isDark: true,
      medicalOverride: "severe-altitude-illness",
    });
    expect(decision.choice).toBe("urgent-assisted-descent");
    expect(decision.reason).toMatch(/generic stay-put rule does not apply/i);
    expect(reconcileTriagePriority({
      altitude: { mustDescend: true, message: "DESCEND NOW" },
      movement: decision,
    })).toMatchObject({ action: "urgent-assisted-descent" });
  });

  it("counts pace beads in 9s", () => {
    expect(paceBeads(9).km).toBe(1);
    expect(paceBeads(10).beads).toBe(1);
    expect(paceBeads(Number.NaN).label).toMatch(/cannot determine/i);
    expect(watchMethodHeading(Number.POSITIVE_INFINITY, "north")).toBeNull();
    expect(polarisHint(91)).toBeNull();
    expect(gridConvergence(91, 0)).toBeNull();
  });

  it("builds a lost-person query", () => {
    const q = lostPersonQuery({ name: "Alex", clothing: "red jacket", lat: 37.1, lng: -119.2 });
    expect(q).toContain("Alex");
    expect(q).toContain("Your grid now");
  });
});
