import { describe, expect, it } from "vitest";
import { hikeReadiness } from "./readiness";
import { stabilizeLoop, type TrailProgress } from "@/lib/geo/navigation";
import { buildPaperBackup } from "./paper-backup";

const ice = {
  name: "Pat",
  iceName: "Sam",
  icePhone: "555-123-4567",
  medical: "",
  partySize: 2,
};

describe("hikeReadiness", () => {
  it("blocks navigate without ICE or return time", () => {
    expect(
      hikeReadiness({
        packReady: true,
        profile: { ...ice, icePhone: "" },
        returnAt: "2026-08-20T18:00:00Z",
      }).ok,
    ).toBe(false);
    expect(
      hikeReadiness({ packReady: true, profile: ice, returnAt: null }).missing,
    ).toContain("Planned return time");
  });

  it("passes when pack, ICE, and return are set", () => {
    expect(
      hikeReadiness({
        packReady: true,
        profile: ice,
        returnAt: "2026-08-20T18:00:00Z",
      }).ok,
    ).toBe(true);
  });

  it("does not require a check-in interval", () => {
    expect(
      hikeReadiness({
        packReady: true,
        profile: ice,
        returnAt: "2026-08-20T18:00:00Z",
      }).missing,
    ).toEqual([]);
  });
});

describe("stabilizeLoop", () => {
  it("does not jump remaining to the start near the last vertex", () => {
    const progress: TrailProgress = {
      nearest: { lat: 37, lng: -119 },
      offsetMeters: 2,
      traveledMeters: 10,
      remainingMeters: 990,
      totalMeters: 1000,
      remainingElevationMeters: 0,
      remainingDirection: "forward",
      bearingToTrail: 0,
      valid: true,
    };
    const kept = stabilizeLoop(progress, { traveledMeters: 980 });
    expect(kept.traveledMeters).toBe(1000);
    expect(kept.remainingMeters).toBe(0);
  });
});

describe("buildPaperBackup", () => {
  it("includes route card, ICE, and start/end grids", () => {
    const text = buildPaperBackup({
      trailName: "Mist Trail",
      geometry: {
        type: "LineString",
        coordinates: [
          [-119.53, 37.73],
          [-119.54, 37.74],
        ],
      },
      profile: ice,
      returnAt: "2026-08-20T18:00:00Z",
    });
    expect(text).toMatch(/PAPER BACKUP/);
    expect(text).toMatch(/ROUTE CARD/);
    expect(text).toMatch(/Sam/);
    expect(text).toMatch(/Start USNG/);
  });
});

/**
 * The checklist must never be the only path to the map.
 *
 * hikeReadiness is advisory: it lists what is missing. Whether that BLOCKS
 * navigation is a UI decision, and blocking it on a pack that is already
 * downloaded and valid is unsafe -- someone already out, disoriented, on a
 * dying battery cannot fill in a form. These assertions pin the distinction so
 * a future change cannot quietly turn the advisory list back into a hard gate.
 */
describe("readiness is advisory, not a lock", () => {
  const emptyProfile = { name: "", iceName: "", icePhone: "", medical: "", partySize: 1 };

  it("reports missing items without claiming the route is unusable", () => {
    const result = hikeReadiness({ packReady: true, profile: emptyProfile, returnAt: null });
    expect(result.ok).toBe(false);
    expect(result.missing.length).toBeGreaterThan(0);
    // The pack is present, so "no offline route pack" must NOT be among them:
    // that is the only item that genuinely makes navigation impossible.
    expect(result.missing.join(" ")).not.toMatch(/route pack/i);
  });

  it("flags the one condition that really does prevent navigating", () => {
    const result = hikeReadiness({ packReady: false, profile: emptyProfile, returnAt: null });
    expect(result.missing.join(" ")).toMatch(/route pack/i);
  });
});
