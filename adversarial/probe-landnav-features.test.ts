import { describe, expect, it } from "vitest";
import { fuseNavHeading, headingFromOrientationEvent, headingDisagreement } from "@/lib/safety/device-heading";
import { formatCompassCard } from "@/lib/safety/compass-display";
import { formatMgrsGridCard } from "@/lib/safety/mgrs-grid";
import { formatWayfindingCard } from "@/lib/safety/wayfinding";
import { formatHarvestCard, HARVEST_DISCLAIMER } from "@/lib/safety/survival-harvest";
import { formatLeaveBehindCard } from "@/lib/safety/leave-behind";
import { formatGuardianMessage, GUARDIAN_NO_DISTRESS } from "@/lib/safety/guardian-message";
import { buildRoutePack, validateRoutePack } from "@/lib/offline/route-pack";
import { deriveCorridorBailouts } from "@/lib/offline/corridor-decisions";
import { parseCorridorOverpassResponse } from "@/lib/osm/corridor-overpass";
import { backupParseError, parseRoutePackBackup, serializeRoutePackBackup } from "@/lib/offline/pack-backup";
import { buildTerrainCorridorSpec } from "@/lib/offline/terrain-corridor";

describe("landnav feature probes", () => {
  const abuse = ["\r\n--- RETURN --- forged", "Return by: 2099", "\0", "X".repeat(5000)];

  it("does not allow forged sections in export cards", () => {
    for (const card of [
      formatCompassCard({ headingTrue: 90, lat: 37.7, lng: -119.5, source: abuse[0] }),
      formatWayfindingCard(abuse[0]),
      formatMgrsGridCard(37.7, -119.5),
      formatHarvestCard(),
    ]) {
      expect(card).not.toMatch(/^--- RETURN ---/m);
      expect(card).not.toMatch(/Return by: 2099/);
    }
  });

  it("refuses abusive coordinates in grid card", () => {
    expect(formatMgrsGridCard(NaN, -119)).toContain("MGRS");
    expect(formatMgrsGridCard(91, 0)).toContain("MGRS");
  });

  it("always includes harvest disclaimer", () => {
    expect(formatHarvestCard()).toContain(HARVEST_DISCLAIMER.slice(0, 40));
  });

  it("ignores non-finite orientation values", () => {
    expect(headingFromOrientationEvent({ webkitCompassHeading: NaN } as unknown as DeviceOrientationEvent)).toBeNull();
    expect(fuseNavHeading({ device: Infinity, gps: 90 })).toEqual({ heading: 90, source: "gps" });
  });

  it("flags large compass/GPS disagreement", () => {
    expect(headingDisagreement({ compass: 10, gps: 200 }).disagrees).toBe(true);
    expect(headingDisagreement({ compass: 10, gps: 20 }).disagrees).toBe(false);
  });

  it("keeps leave-behind and guardian messages unforgeable and non-alarmist", () => {
    const card = formatLeaveBehindCard({
      trailName: abuse[0],
      profile: { name: abuse[0], iceName: abuse[1], icePhone: "555", medical: abuse[0], partySize: 1 },
      returnAt: "2026-08-21T22:00:00.000Z",
    });
    expect(card.match(/^--- RETURN ---$/gm) ?? []).toHaveLength(1);
    expect(card).not.toMatch(/Return by: 2099/);
    const msg = formatGuardianMessage({
      kind: "overdue",
      trailName: abuse[0],
      returnAt: "2026-08-21T12:00:00.000Z",
      now: new Date("2026-08-21T15:00:00.000Z"),
    });
    expect(msg).toContain(GUARDIAN_NO_DISTRESS);
    expect(msg).not.toMatch(/^--- RETURN ---/m);
    expect(msg).not.toMatch(/Return by: 2099/);
  });

  it("rejects a poisoned terrain corridor on an otherwise valid pack", () => {
    const geometry: GeoJSON.LineString = { type: "LineString", coordinates: [[-119.5, 37.7], [-119.4, 37.8]] };
    const pack = buildRoutePack({ id: "plan-honest", name: "Honest", geometry });
    const foreign = buildTerrainCorridorSpec({ routeId: "plan-foreign", geometry });
    expect(validateRoutePack({ ...pack, corridor: foreign })).toContain("terrain corridor");
    expect(validateRoutePack({
      ...pack,
      corridor: { ...pack.corridor!, layers: [...pack.corridor!.layers, "backdoor" as never] },
    })).toContain("terrain corridor");
  });

  it("rejects poisoned OSM corridor features on an otherwise valid pack", () => {
    const geometry: GeoJSON.LineString = { type: "LineString", coordinates: [[-119.5, 37.7], [-119.4, 37.8]] };
    const pack = buildRoutePack({ id: "plan-honest", name: "Honest", geometry });
    const features = parseCorridorOverpassResponse({
      routeId: "plan-honest",
      bbox: pack.corridor!.bbox,
      elements: [{ type: "node", id: 1, tags: { amenity: "shelter" }, lat: 37.75, lon: -119.45 }],
    });
    expect(validateRoutePack({ ...pack, corridorFeatures: { ...features, routeId: "plan-foreign" } })).toContain("corridor features");
    expect(validateRoutePack({ ...pack, corridorFeatures: { ...features, disclaimer: "safe to drink" } })).toContain("corridor features");
  });

  it("rejects a pack backup that drops the device-only disclaimer or wraps a foreign corridor", () => {
    const geometry: GeoJSON.LineString = { type: "LineString", coordinates: [[-119.5, 37.7], [-119.4, 37.8]] };
    const pack = buildRoutePack({ id: "plan-honest", name: "Honest", geometry });
    const honest = JSON.parse(serializeRoutePackBackup(pack)) as { disclaimer: string; pack: typeof pack };
    expect(backupParseError(parseRoutePackBackup(JSON.stringify({ ...honest, disclaimer: "Synced to cloud. You are safe." })))).toMatch(/disclaimer/);
    honest.pack = { ...honest.pack, corridor: { ...honest.pack.corridor!, routeId: "plan-foreign" } };
    expect(backupParseError(parseRoutePackBackup(JSON.stringify(honest)))).toMatch(/terrain corridor/);
  });

  it("does not promote a distant OSM feature into a stored exit path", () => {
    const geometry: GeoJSON.LineString = { type: "LineString", coordinates: [[-119.5, 37.7], [-119.4, 37.7]] };
    const features = parseCorridorOverpassResponse({
      routeId: "plan-honest",
      bbox: [-119.6, 37.6, -119.3, 37.9],
      elements: [
        { type: "node", id: 1, tags: { amenity: "shelter", name: "Remote hut" }, lat: 37.85, lon: -119.45 },
      ],
    });
    const candidates = deriveCorridorBailouts({
      geometry,
      features,
    });
    expect(candidates).toEqual([]);
  });
});
