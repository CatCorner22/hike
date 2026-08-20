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

  it("treats an epoch deadline as set so the HUD can show OVERDUE", () => {
    expect(
      hikeReadiness({
        packReady: true,
        profile: ice,
        returnAt: "1970-01-01T00:00:00.000Z",
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
  it("includes route card, ICE, and both route-end grids", () => {
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
    // Was `Start USNG`. That label asserted a trailhead from the arbitrary stored line
    // direction; the sheet now names both ends by compass position unless the hiker's
    // own start is supplied.
    expect(text).toMatch(/West end/);
    expect(text).toMatch(/East end/);
  });
});

describe("buildPaperBackup — the sheet a searcher reads", () => {
  const line: GeoJSON.LineString = {
    type: "LineString",
    coordinates: [
      [-119.56, 37.75],
      [-119.5, 37.75],
    ],
  };
  const profile = { name: "H", iceName: "C", icePhone: "5551234567", medical: "", partySize: 2 };

  /**
   * Regression: formatUsng returns string | null since it started refusing latitudes
   * outside the UTM grid, and the result was interpolated straight into the sheet —
   * printing "Start USNG: null" on a page whose header says "hand to SAR".
   */
  it("never prints the string null for a grid", () => {
    const polar: GeoJSON.LineString = {
      type: "LineString",
      coordinates: [[-120, 85.2], [-119.9, 85.3]],
    };
    const sheet = buildPaperBackup({ trailName: "Arctic", geometry: polar, profile });
    expect(sheet).not.toMatch(/\bnull\b/);
    expect(sheet).toMatch(/unavailable/i);
  });

  /**
   * Regression: the sheet labelled the westernmost end "Start USNG". Stored line
   * direction is arbitrary (stitchRelationWays normalises chains west-east), so on a
   * route walked east-to-west that sent a searcher to the wrong trailhead.
   */
  it("does not claim a trailhead it cannot know", () => {
    const sheet = buildPaperBackup({ trailName: "Ridge", geometry: line, profile });
    expect(sheet).not.toMatch(/Start USNG/);
    expect(sheet).toMatch(/West end/);
    expect(sheet).toMatch(/East end/);
    expect(sheet).toMatch(/NOT recorded on this sheet/);
  });

  it("names the trailhead once the hiker's own start is known", () => {
    const fromEast = buildPaperBackup({
      trailName: "Ridge", geometry: line, profile,
      startedFrom: { lat: 37.75, lng: -119.5 },
    });
    expect(fromEast).toMatch(/TRAILHEAD \(party set off here\)/);
    expect(fromEast).not.toMatch(/NOT recorded/);

    const fromWest = buildPaperBackup({
      trailName: "Ridge", geometry: line, profile,
      startedFrom: { lat: 37.75, lng: -119.56 },
    });
    // The two starts must not resolve to the same grid.
    const grid = (t: string) => t.split("\n").find((l) => l.startsWith("TRAILHEAD"));
    expect(grid(fromEast)).not.toBe(grid(fromWest));
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
