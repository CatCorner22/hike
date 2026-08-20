import { describe, expect, it } from "vitest";
import { overdueStatus, resolveLocalDateTime } from "./profile";

describe("return-time resolution", () => {
  it("rejects spring-forward gaps instead of silently shifting the deadline", () => {
    expect(resolveLocalDateTime("2026-03-08T02:30", "America/New_York")).toMatchObject({
      kind: "nonexistent",
    });
  });

  it("requires an explicit occurrence for repeated fall-back local time", () => {
    const ambiguous = resolveLocalDateTime("2026-11-01T01:30", "America/New_York");
    expect(ambiguous.kind).toBe("ambiguous");
    if (ambiguous.kind !== "ambiguous") return;
    expect(ambiguous.choices[0].instant.getTime()).not.toBe(ambiguous.choices[1].instant.getTime());
    expect(resolveLocalDateTime("2026-11-01T01:30", "America/New_York", "earlier")).toMatchObject({
      kind: "resolved",
      value: { utcOffset: "GMT-4" },
    });
    expect(resolveLocalDateTime("2026-11-01T01:30", "America/New_York", "later")).toMatchObject({
      kind: "resolved",
      value: { utcOffset: "GMT-5" },
    });
  });

  it("does not label an invalid persisted deadline as overdue", () => {
    expect(overdueStatus("not-a-date")).toMatchObject({
      overdue: false,
      remainingMin: null,
    });
  });
});
