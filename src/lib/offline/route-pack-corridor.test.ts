import { describe, expect, it } from "vitest";
import {
  buildRoutePack,
  routePackStatus,
  validateRoutePack,
  MAX_ROUTE_PACK_BYTES,
  ROUTE_PACK_VERSION,
  type RoutePack,
} from "@/lib/offline/route-pack";
import {
  normalizeCorridor,
  DEFAULT_CORRIDOR_METERS,
  MAX_CORRIDOR_FEATURES,
  type OfflineCorridor,
} from "@/lib/offline/corridor";

const geometry: GeoJSON.LineString = {
  type: "LineString",
  coordinates: [
    [-119.53, 37.77],
    [-119.52, 37.78],
    [-119.51, 37.79],
  ],
};

function smallCorridor(): OfflineCorridor {
  return normalizeCorridor({
    bufferMeters: DEFAULT_CORRIDOR_METERS,
    bbox: [-119.6, 37.7, -119.4, 37.85],
    lines: [{ kind: "road", name: "Forest Rd", positions: [[-119.55, 37.75], [-119.54, 37.76]] }],
    points: [{ kind: "water", lat: 37.76, lng: -119.54 }],
  });
}

/**
 * A corridor that fails the persistence check, built directly rather than through
 * `normalizeCorridor`.
 *
 * This is deliberate. `normalizeCorridor` caps a corridor at roughly 3 MB, so a
 * normalized corridor cannot on its own exceed the 16 MB pack budget -- the
 * size-drop path is defence in depth, reachable only by a corridor that arrived
 * from somewhere other than the normalizer: an older pack, a future code path, or
 * a tampered record. Feeding it a corridor that is over the feature cap exercises
 * the same branch honestly, without a fixture that pretends to be a size the
 * normalizer would never emit.
 */
function unstorableCorridor(): OfflineCorridor {
  const base = smallCorridor();
  return {
    ...base,
    lines: Array.from({ length: MAX_CORRIDOR_FEATURES + 100 }, () => ({
      kind: "trail" as const,
      positions: [
        [-119.5, 37.7],
        [-119.49, 37.71],
      ] as GeoJSON.Position[],
    })),
  };
}

describe("route packs carry corridors additively", () => {
  it("stores a corridor when one is supplied", () => {
    const pack = buildRoutePack({ id: "plan-1", name: "Route", geometry, corridor: smallCorridor() });
    expect(pack.corridor?.lines).toHaveLength(1);
    expect(validateRoutePack(pack)).toBeNull();
    expect(routePackStatus(pack)).toBe("ready");
  });

  it("builds a valid pack with no corridor at all", () => {
    const pack = buildRoutePack({ id: "plan-2", name: "Route", geometry });
    expect(pack.corridor).toBeUndefined();
    expect(routePackStatus(pack)).toBe("ready");
  });

  it("leaves a pack saved before corridors existed ready, not stale", () => {
    // Adding this field deliberately did NOT bump ROUTE_PACK_VERSION. A bump
    // would mark every already-prepared pack stale and tell a hiker who did
    // everything right that their offline data can no longer be trusted --
    // possibly while they are standing at a trailhead with no signal.
    const legacy = buildRoutePack({ id: "plan-3", name: "Route", geometry });
    const withoutCorridorField: RoutePack = { ...legacy };
    delete (withoutCorridorField as { corridor?: unknown }).corridor;
    expect(withoutCorridorField.version).toBe(ROUTE_PACK_VERSION);
    expect(routePackStatus(withoutCorridorField)).toBe("ready");
    expect(validateRoutePack(withoutCorridorField)).toBeNull();
  });

  it("rejects a corrupt corridor rather than storing it", () => {
    const pack = buildRoutePack({ id: "plan-4", name: "Route", geometry, corridor: smallCorridor() });
    const poisoned: RoutePack = {
      ...pack,
      corridor: { ...pack.corridor!, coverage: "probably" as never },
    };
    expect(validateRoutePack(poisoned)).toMatch(/corridor/i);
    expect(routePackStatus(poisoned)).toBe("invalid");
  });

  it("saves the route without the corridor when the corridor cannot be stored", () => {
    // The corridor is context; the route is the Safety Map. A hiker who asked for
    // extra offline detail must never end up with no offline route because of it.
    const pack = buildRoutePack({ id: "plan-5", name: "Route", geometry, corridor: unstorableCorridor() });
    expect(validateRoutePack(pack)).toBeNull();
    expect(pack.geometry.coordinates).toHaveLength(3);
    expect(pack.corridor?.lines ?? []).toHaveLength(0);
    expect(pack.corridor?.coverage ?? "failed").toBe("failed");
    expect(pack.corridor?.note ?? "").toMatch(/storage limit/i);
  });

  it("keeps the normalizer's own output inside the pack budget", () => {
    // Guards the invariant the test above depends on: a normalized corridor must
    // always be small enough that the route never has to be traded for it.
    const maxed = normalizeCorridor({
      bufferMeters: DEFAULT_CORRIDOR_METERS,
      bbox: [-119.6, 37.7, -119.4, 37.85],
      lines: Array.from({ length: MAX_CORRIDOR_FEATURES + 500 }, () => ({
        kind: "trail" as const,
        positions: Array.from({ length: 40 }, (_, step) => [
          -119.512345678 + step * 0.000123456,
          37.712345678 + step * 0.000123456,
        ] as GeoJSON.Position),
      })),
      points: [],
    });
    const bytes = new TextEncoder().encode(JSON.stringify(maxed)).byteLength;
    expect(bytes).toBeLessThan(MAX_ROUTE_PACK_BYTES / 2);
    const pack = buildRoutePack({ id: "plan-7", name: "Route", geometry, corridor: maxed });
    expect(validateRoutePack(pack)).toBeNull();
    expect(pack.corridor?.lines.length).toBeGreaterThan(0);
  });

  it("still refuses a route that is itself invalid", () => {
    // The corridor fallback must not become a way for bad geometry to get in.
    expect(() =>
      buildRoutePack({
        id: "plan-6",
        name: "Route",
        geometry: { type: "LineString", coordinates: [[0, 0]] },
        corridor: smallCorridor(),
      }),
    ).toThrow();
  });
});
