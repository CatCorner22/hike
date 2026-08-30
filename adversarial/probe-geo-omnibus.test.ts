import { describe, expect, it } from "vitest";
import {
  progressAlongTrail,
  trailLengthMeters,
  routeMidpoint,
  routeSpine,
  halfwayStatus,
  safeBbox,
  travelDirectionAlong,
} from "@/lib/geo/navigation";
import {
  createRouteProgressCache,
  progressWithRouteCache,
} from "@/lib/offline/progress-cache";
import { cumulativeDistancesForGeometry, MAX_ROUTE_PACK_COORDINATES } from "@/lib/offline/route-pack";
import type { RoutePack } from "@/lib/offline/route-pack";

function pack(geometry: GeoJSON.LineString | GeoJSON.MultiLineString): RoutePack {
  const cumulative = cumulativeDistancesForGeometry(geometry);
  return {
    version: 1,
    id: "probe",
    kind: "trail",
    name: "probe",
    geometry,
    cumulativeDistancesMeters: cumulative,
    lengthMeters: cumulative[cumulative.length - 1] ?? 0,
    cachedAt: Date.now(),
    elevationProfile: [],
  } as unknown as RoutePack;
}

const line: GeoJSON.LineString = {
  type: "LineString",
  coordinates: Array.from({ length: 200 }, (_, i) => [-119, 37 + i * 0.0005]),
};

const gapped: GeoJSON.MultiLineString = {
  type: "MultiLineString",
  coordinates: [
    Array.from({ length: 50 }, (_, i) => [-119, 37 + i * 0.0005]),
    Array.from({ length: 50 }, (_, i) => [-118.5, 37.2 + i * 0.0005]),
  ],
};

describe("cache vs direct agreement", () => {
  for (const [name, geometry] of [["line", line], ["gapped", gapped]] as const) {
    it(`agrees on ${name}`, () => {
      const cache = createRouteProgressCache(pack(geometry));
      for (const t of [0, 0.1, 0.49, 0.5, 0.51, 0.9, 1]) {
        const lines = geometry.type === "LineString" ? [geometry.coordinates] : geometry.coordinates;
        const flat = lines.flat();
        const p = flat[Math.min(Math.floor(t * flat.length), flat.length - 1)];
        const point = { lat: p[1], lng: p[0] };
        const direct = progressAlongTrail(point, geometry, [], "forward");
        const cached = progressWithRouteCache(cache, point, "forward");
        expect(Number.isFinite(cached.traveledMeters)).toBe(true);
        expect(cached.traveledMeters).toBeCloseTo(direct.traveledMeters, -1);
        expect(cached.remainingMeters).toBeCloseTo(direct.remainingMeters, -1);
        expect(cached.totalMeters).toBeCloseTo(direct.totalMeters, -1);
      }
    });
  }
});

describe("midpoint agreement", () => {
  it("marker and text agree on where halfway is", () => {
    for (const geometry of [line, gapped]) {
      const mid = routeMidpoint(geometry)!;
      const total = trailLengthMeters(geometry);
      const spine = routeSpine(geometry);
      const at = progressAlongTrail(mid, geometry, [], "forward");
      const status = halfwayStatus(at.traveledMeters, total, "forward", spine)!;
      expect(status.distanceMeters).toBeLessThan(5);
      expect(status.gapMeters).toBe(0);
    }
  });
});

describe("hostile geometry", () => {
  const hostile: Array<[string, unknown]> = [
    ["antimeridian", { type: "LineString", coordinates: [[179.99, 0], [-179.99, 0]] }],
    ["poles", { type: "LineString", coordinates: [[0, 89.999], [0, -89.999]] }],
    ["duplicate points", { type: "LineString", coordinates: [[0, 0], [0, 0], [0, 0]] }],
    ["huge coords", { type: "LineString", coordinates: [[1e9, 1e9], [-1e9, -1e9]] }],
    ["string coords", { type: "LineString", coordinates: [["0", "0"], ["1", "1"]] }],
    ["3d coords", { type: "LineString", coordinates: [[0, 0, 100], [0.01, 0.01, 200]] }],
    ["empty multi", { type: "MultiLineString", coordinates: [] }],
    ["nested null", { type: "MultiLineString", coordinates: [[[0, 0], [0, 0.01]], [[null, 1], [1, 1]]] }],
  ];
  for (const [name, geometry] of hostile) {
    it(`survives ${name}`, () => {
      const g = geometry as GeoJSON.LineString;
      const total = trailLengthMeters(g);
      expect(Number.isFinite(total)).toBe(true);
      const p = progressAlongTrail({ lat: 0.005, lng: 0.005 }, g, [], "forward");
      expect(Number.isFinite(p.traveledMeters)).toBe(true);
      expect(Number.isFinite(p.remainingMeters)).toBe(true);
      expect(p.remainingMeters).toBeGreaterThanOrEqual(0);
      const bbox = safeBbox(g, { lat: 0.005, lng: 0.005 });
      if (bbox) expect(bbox.every(Number.isFinite)).toBe(true);
      const mid = routeMidpoint(g);
      if (mid) {
        expect(Number.isFinite(mid.lat)).toBe(true);
        expect(Number.isFinite(mid.lng)).toBe(true);
      }
      const spine = routeSpine(g);
      expect(spine.gapsMeters.every((v) => Number.isFinite(v))).toBe(true);
      expect(travelDirectionAlong(g, [{ lat: 0, lng: 0 }, { lat: 0.01, lng: 0 }])).toBeTruthy();
      const status = halfwayStatus(total / 2, total, "forward", spine);
      if (status) {
        expect(Number.isFinite(status.distanceMeters)).toBe(true);
        expect(Number.isFinite(status.gapMeters)).toBe(true);
      }
    });
  }
});

describe("scale", () => {
  it("keeps cache progress finite at the coordinate cap", () => {
    const big: GeoJSON.LineString = {
      type: "LineString",
      coordinates: Array.from({ length: MAX_ROUTE_PACK_COORDINATES }, (_, i) => [
        -119 + i * 1e-6,
        37 + i * 1e-6,
      ]),
    };
    const cache = createRouteProgressCache(pack(big));
    const p = progressWithRouteCache(cache, { lat: 37.05, lng: -118.95 }, "forward");
    expect(Number.isFinite(p.traveledMeters)).toBe(true);
    expect(Number.isFinite(p.remainingMeters)).toBe(true);
  });
});
