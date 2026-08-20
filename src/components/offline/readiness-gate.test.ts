import { describe, expect, it } from "vitest";
import { resolveGateReturnTime } from "./readiness-gate";

describe("ReadinessGate repeated local return times", () => {
  it("resolves the explicitly selected first or second fall-back occurrence", () => {
    const local = "2026-11-01T01:30";
    const ambiguous = resolveGateReturnTime(local, null, "America/New_York");
    const earlier = resolveGateReturnTime(local, "earlier", "America/New_York");
    const later = resolveGateReturnTime(local, "later", "America/New_York");

    if (!ambiguous || !earlier || !later) throw new Error("Expected a local return-time resolution");
    expect(ambiguous.kind).toBe("ambiguous");
    expect(earlier.kind).toBe("resolved");
    expect(later.kind).toBe("resolved");
    if (earlier.kind !== "resolved" || later.kind !== "resolved") throw new Error("Expected resolved choices");
    expect(earlier.value.utcOffset).not.toBe(later.value.utcOffset);
    expect(earlier.value.instant.getTime()).toBeLessThan(later.value.instant.getTime());
  });
});
