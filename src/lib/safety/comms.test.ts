import { describe, expect, it } from "vitest";
import {
  checkInSchedule,
  formatPacePlan,
  lineOfSightRangeKm,
  pacePlan,
  pacePlanTemplate,
  radioHorizonKm,
  rangeAdvice,
} from "./comms";

describe("radio horizon and communications planning", () => {
  it("computes the standard geometric horizon at a known height", () => {
    expect(radioHorizonKm(100)).toBeCloseTo(35.7, 1);
    expect(lineOfSightRangeKm(100, 100)).toBeCloseTo(71.4, 1);
  });

  it("rejects invalid radio heights", () => {
    expect(radioHorizonKm(Number.NaN)).toBeNull();
    expect(radioHorizonKm(-1)).toBeNull();
    expect(lineOfSightRangeKm(Number.NaN, 10)).toBeNull();
  });

  it("makes terrain blockage a high-ground warning", () => {
    const advice = rangeAdvice({ myElevationM: 20, theirElevationM: 30, terrainBlocked: true });
    expect(advice.km).toBeNull();
    expect(advice.severity).toBe("warning");
    expect(advice.message).toMatch(/high ground/i);
  });

  it("formats an explicit PACE plan", () => {
    const plan = pacePlan({ primary: " satellite ", alternate: "radio", contingency: "contact", emergency: "PLB" });
    expect(plan.primary).toBe("satellite");
    expect(formatPacePlan(plan)).toContain("P — PRIMARY: satellite");
    expect(pacePlanTemplate().emergency).toMatch(/PLB/);
  });

  it("creates a capped, valid check-in schedule", () => {
    const schedule = checkInSchedule({
      departureIso: "2026-08-20T12:00:00.000Z",
      expectedReturnIso: "2026-08-20T18:00:00.000Z",
      intervalHours: 2,
    });
    expect(schedule).toEqual([
      "2026-08-20T12:00:00.000Z",
      "2026-08-20T14:00:00.000Z",
      "2026-08-20T16:00:00.000Z",
      "2026-08-20T18:00:00.000Z",
    ]);
    expect(
      checkInSchedule({
        departureIso: "not-a-date",
        expectedReturnIso: "2026-08-20T18:00:00.000Z",
        intervalHours: 2,
      }),
    ).toBeNull();
  });
});
