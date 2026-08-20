import { describe, expect, it } from "vitest";
import { criticalNotices, safetyBriefFreshness, type OfflineSafetyBrief } from "./safety-brief";

const base: OfflineSafetyBrief = { generatedAt: "2026-08-20T12:00:00Z", decisionPoints: [], notices: [] };

describe("offline safety brief", () => {
  it("reports unknown when source expiry is unknown", () => {
    expect(safetyBriefFreshness(base, Date.parse("2026-08-20T13:00:00Z"))).toBe("unknown");
  });

  it("does not hide an expired source", () => {
    const brief: OfflineSafetyBrief = { ...base, notices: [{ id: "n", severity: "watch", title: "Closure", source: { label: "land manager", retrievedAt: "2026-08-20T12:00:00Z", expiresAt: "2026-08-20T12:30:00Z" } }] };
    expect(safetyBriefFreshness(brief, Date.parse("2026-08-20T13:00:00Z"))).toBe("stale");
  });

  it("surfaces critical notices", () => {
    const brief: OfflineSafetyBrief = { ...base, notices: [{ id: "a", severity: "info", title: "Info" }, { id: "b", severity: "critical", title: "Closed" }] };
    expect(criticalNotices(brief).map((notice) => notice.id)).toEqual(["b"]);
  });
});
