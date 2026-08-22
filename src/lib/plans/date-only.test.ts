import { describe, expect, it } from "vitest";
import { formatPlannedDate, plannedDateOnly, plannedDateToIso } from "./date-only";

describe("plan calendar dates", () => {
  it("stores a date-only choice at a U.S.-safe neutral instant", () => {
    expect(plannedDateToIso("2026-08-22")).toBe("2026-08-22T12:00:00.000Z");
  });

  it("formats legacy UTC-midnight rows without shifting the calendar day", () => {
    expect(formatPlannedDate("2026-08-22T00:00:00.000Z", "full")).toBe(
      "Saturday, Aug 22, 2026",
    );
  });

  it("holds dates on both sides of U.S. daylight-saving boundaries", () => {
    expect(formatPlannedDate("2026-03-07T00:00:00.000Z")).toBe("Mar 7, 2026");
    expect(formatPlannedDate("2026-03-08T00:00:00.000Z")).toBe("Mar 8, 2026");
    expect(formatPlannedDate("2026-11-01T00:00:00.000Z")).toBe("Nov 1, 2026");
    expect(formatPlannedDate("2026-11-02T00:00:00.000Z")).toBe("Nov 2, 2026");
  });

  it("rejects impossible or malformed dates", () => {
    expect(plannedDateOnly("2026-02-30")).toBeNull();
    expect(plannedDateOnly("08/22/2026")).toBeNull();
    expect(plannedDateOnly(new Date(Number.NaN))).toBeNull();
    expect(plannedDateToIso("")).toBeNull();
  });
});
