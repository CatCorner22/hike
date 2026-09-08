import { describe, expect, it } from "vitest";
import { formatNavLog, type NavLeg } from "./navlog";

/**
 * Every bearing rendered to the user is in [0, 360): 359.7° is 0°, and a negative
 * azimuth renders as its compass equivalent — the same invariant the mils display
 * (6400 → 0) and the shadow hint already enforce. A leg that printed "360°" or
 * "-122°" asked the hiker to set a compass to a direction that does not exist.
 */
describe("formatNavLog bearing normalization", () => {
  it("renders every bearing in [0, 360)", () => {
    const legs = [
      { id: "1", packId: "p", azimuthTrue: 359.7, distanceM: 100, terrain: "open", startedAt: "2026-08-20T10:00:00Z" },
      { id: "2", packId: "p", azimuthTrue: -122.3, distanceM: 100, terrain: "open", startedAt: "2026-08-20T10:00:00Z" },
    ] as unknown as NavLeg[];
    const out = formatNavLog(legs);
    expect(out).toMatch(/L1 +0° /);
    expect(out).toMatch(/L2 +238° /);
    expect(out).not.toMatch(/360°|-122/);
  });

  it("keeps the empty and UNKNOWN paths", () => {
    expect(formatNavLog([])).toBe("NAV LOG empty");
    const legs = [
      { id: "1", packId: "p", azimuthTrue: Number.NaN, distanceM: 100, terrain: "open", startedAt: "2026-08-20T10:00:00Z" },
    ] as unknown as NavLeg[];
    expect(formatNavLog(legs)).toMatch(/UNKNOWN°/);
  });
});
