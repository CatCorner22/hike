import { describe, expect, it } from "vitest";
import { sortUpcomingPlans } from "./upcoming";

describe("sortUpcomingPlans", () => {
  /**
   * Regression: this sorted descending, so with more than five dated plans the
   * card showed the furthest-future trips and cut the imminent one — the plan
   * the hiker opened the app to check.
   */
  it("puts the soonest plan first and keeps it inside a five-row card", () => {
    const plans = [
      { id: "sep", plannedDate: "2026-09-20" },
      { id: "dec", plannedDate: "2026-12-01" },
      { id: "aug24", plannedDate: "2026-08-24" },
      { id: "oct", plannedDate: "2026-10-05" },
      { id: "nov", plannedDate: "2026-11-11" },
      { id: "next-year", plannedDate: "2027-01-15" },
    ];
    const sorted = sortUpcomingPlans(plans);
    expect(sorted[0].id).toBe("aug24");
    expect(sorted.slice(0, 5).map((p) => p.id)).toContain("aug24");
    expect(sorted.at(-1)!.id).toBe("next-year");
  });

  it("sorts undated and unparseable plans last, never first", () => {
    const sorted = sortUpcomingPlans([
      { id: "none", plannedDate: null },
      { id: "garbage", plannedDate: "not-a-date" },
      { id: "dated", plannedDate: "2026-08-24" },
      { id: "missing" },
    ]);
    expect(sorted[0].id).toBe("dated");
    expect(sorted.slice(1).map((p) => p.id).sort()).toEqual(["garbage", "missing", "none"]);
  });

  it("accepts Date objects as well as ISO strings and does not mutate the input", () => {
    const input = [
      { id: "later", plannedDate: new Date("2026-09-01T00:00:00Z") },
      { id: "sooner", plannedDate: new Date("2026-08-24T00:00:00Z") },
    ];
    const sorted = sortUpcomingPlans(input);
    expect(sorted.map((p) => p.id)).toEqual(["sooner", "later"]);
    expect(input.map((p) => p.id)).toEqual(["later", "sooner"]);
  });
});
