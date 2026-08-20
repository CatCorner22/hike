import { describe, expect, it } from "vitest";
import { assessDaylightMargin, guardianStatus, nextDecisionPoint } from "./decision-support";

describe("decision support", () => {
  it("orders the next decision point by route distance", () => {
    const next = nextDecisionPoint([
      { id: "b", name: "Road", distanceMeters: 5000, kind: "road" },
      { id: "a", name: "Junction", distanceMeters: 2500, kind: "junction" },
    ], 2000);
    expect(next?.id).toBe("a");
  });

  it("does not claim that an overdue hiker is distressed", () => {
    const result = guardianStatus(new Date("2026-08-20T22:00:00Z"), new Date("2026-08-20T21:30:00Z"));
    expect(result.state).toBe("overdue");
    expect(result.message).toContain("does not establish why");
  });

  it("flags an ETA after sunset as critical", () => {
    const result = assessDaylightMargin({
      now: new Date("2026-08-20T22:00:00Z"),
      lat: 35.96,
      lng: -83.92,
      remainingMeters: 20_000,
      paceMetersPerHour: 2000,
    });
    expect(["watch", "critical"]).toContain(result.severity);
  });
});
