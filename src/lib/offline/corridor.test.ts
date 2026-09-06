import { describe, expect, it } from "vitest";
import {
  corridorBounds,
  corridorCoverageLabel,
  corridorPositionCount,
  corridorValidationError,
  normalizeCorridor,
  DEFAULT_CORRIDOR_METERS,
  MAX_CORRIDOR_METERS,
  MAX_CORRIDOR_FEATURES,
  type OfflineCorridor,
} from "@/lib/offline/corridor";

const route: GeoJSON.LineString = {
  type: "LineString",
  coordinates: [
    [-119.53, 37.77],
    [-119.52, 37.78],
  ],
};

function corridor(overrides: Partial<OfflineCorridor> = {}): OfflineCorridor {
  return normalizeCorridor({
    bufferMeters: DEFAULT_CORRIDOR_METERS,
    bbox: [-119.6, 37.7, -119.4, 37.85],
    lines: [{ kind: "road", name: "Forest Rd", positions: [[-119.55, 37.75], [-119.54, 37.76]] }],
    points: [{ kind: "shelter", name: "Hut", lat: 37.76, lng: -119.54 }],
    ...overrides,
  });
}

describe("corridorBounds", () => {
  it("pads by real distance rather than flat degrees", () => {
    // A flat degree padding shrinks the real corridor toward the poles. At 68N a
    // "2 mile" corridor would be roughly a third of its stated width.
    const equator = corridorBounds({ type: "LineString", coordinates: [[0, 0], [0.01, 0]] });
    const arctic = corridorBounds({ type: "LineString", coordinates: [[0, 68], [0.01, 68]] });
    const equatorWidth = equator!.bbox[2] - equator!.bbox[0];
    const arcticWidth = arctic!.bbox[2] - arctic!.bbox[0];
    expect(arcticWidth).toBeGreaterThan(equatorWidth * 2);
  });

  it("clamps an absurd buffer instead of returning unbounded ground", () => {
    const bounds = corridorBounds(route, 10 ** 9);
    expect(bounds!.bufferMeters).toBe(MAX_CORRIDOR_METERS);
    expect(bounds!.bbox[0]).toBeGreaterThanOrEqual(-180);
    expect(bounds!.bbox[3]).toBeLessThanOrEqual(90);
  });

  it("falls back to the default for an unusable buffer", () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(corridorBounds(route, bad)?.bufferMeters).toBe(DEFAULT_CORRIDOR_METERS);
    }
  });

  it("returns null when the route has no usable bounds", () => {
    expect(corridorBounds({ type: "LineString", coordinates: [] })).toBeNull();
  });

  it("stays inside the globe near the pole", () => {
    const bounds = corridorBounds({ type: "LineString", coordinates: [[0, 89.99], [0.01, 89.99]] }, MAX_CORRIDOR_METERS);
    expect(bounds!.bbox.every(Number.isFinite)).toBe(true);
    expect(bounds!.bbox[3]).toBeLessThanOrEqual(90);
    expect(bounds!.bbox[1]).toBeGreaterThanOrEqual(-90);
  });
});

describe("normalizeCorridor drops rather than repairs", () => {
  it("keeps valid features and reports complete coverage", () => {
    const result = corridor();
    expect(result.lines).toHaveLength(1);
    expect(result.points).toHaveLength(1);
    expect(result.coverage).toBe("complete");
    expect(result.note).toBeUndefined();
  });

  it("downgrades to partial when anything was dropped", () => {
    // Silence here would leave the hiker believing the one road drawn is the only
    // road that exists.
    const result = corridor({
      lines: [
        { kind: "road", positions: [[-119.55, 37.75], [-119.54, 37.76]] },
        { kind: "nonsense" as never, positions: [[-119.55, 37.75], [-119.54, 37.76]] },
      ],
    });
    expect(result.coverage).toBe("partial");
    expect(result.note).toMatch(/could not be read/i);
  });

  it("rejects non-finite and out-of-range coordinates", () => {
    const result = corridor({
      lines: [{ kind: "trail", positions: [[Number.NaN, 37.7], [-119.5, 37.7], [-119.4, 37.71]] }],
      points: [
        { kind: "water", lat: 999, lng: 0 },
        { kind: "water", lat: 37.7, lng: Number.POSITIVE_INFINITY },
        { kind: "water", lat: 37.75, lng: -119.5 },
      ],
    });
    for (const line of result.lines) {
      expect(line.positions.every(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat))).toBe(true);
    }
    expect(result.points).toHaveLength(1);
    expect(result.coverage).toBe("partial");
  });

  it("drops a line that cannot be drawn or followed", () => {
    const result = corridor({ lines: [{ kind: "road", positions: [[-119.5, 37.7]] }], points: [] });
    expect(result.lines).toHaveLength(0);
    expect(result.coverage).toBe("failed");
  });

  it("reports failed, never complete, for an empty corridor", () => {
    // A failed request must not look like "surveyed and found nothing".
    const result = corridor({ lines: [], points: [], coverage: "complete" });
    expect(result.coverage).toBe("failed");
    expect(result.note).toMatch(/paper backup|no surrounding features/i);
  });

  it("truncates at the feature cap and says so", () => {
    const many = Array.from({ length: MAX_CORRIDOR_FEATURES + 50 }, () => ({
      kind: "trail" as const,
      positions: [[-119.5, 37.7], [-119.49, 37.71]] as GeoJSON.Position[],
    }));
    const result = corridor({ lines: many, points: [] });
    expect(result.lines.length).toBeLessThanOrEqual(MAX_CORRIDOR_FEATURES);
    expect(result.coverage).toBe("partial");
    expect(result.note).toMatch(/storage limits/i);
  });

  it("strips control characters from names", () => {
    // These labels are drawn to a canvas and printed onto paper backups.
    const result = corridor({
      points: [{ kind: "shelter", name: "Hut\u0000\u001b[31m\ninjected", lat: 37.76, lng: -119.54 }],
    });
    expect(result.points[0].name).not.toMatch(/[\u0000-\u001f]/);
  });

  it("never trusts a supplied retrievedAt that is not a date", () => {
    for (const bad of ["nonsense", "", undefined]) {
      const result = corridor({ retrievedAt: bad as string | undefined });
      expect(Number.isFinite(Date.parse(result.retrievedAt))).toBe(true);
    }
  });

  it("tolerates non-array inputs without throwing", () => {
    expect(() =>
      normalizeCorridor({
        bufferMeters: DEFAULT_CORRIDOR_METERS,
        bbox: [-1, -1, 1, 1],
        lines: "not-an-array" as unknown,
        points: null as unknown,
      }),
    ).not.toThrow();
  });
});

describe("corridorCoverageLabel is explicit about what is missing", () => {
  it("distinguishes no corridor from a failed one", () => {
    expect(corridorCoverageLabel(null)).toMatch(/route line only/i);
    expect(corridorCoverageLabel(corridor({ lines: [], points: [] }))).toMatch(/could not be downloaded/i);
  });

  it("marks a partial corridor as partial", () => {
    const partial = corridor({ coverage: "partial" });
    expect(corridorCoverageLabel(partial)).toMatch(/partial/i);
  });

  it("states the width for a complete corridor", () => {
    expect(corridorCoverageLabel(corridor())).toMatch(/Route \+ 2 mi corridor/);
  });
});

describe("corridorValidationError guards the persistence boundary", () => {
  it("accepts an absent corridor, because a route-only pack is valid", () => {
    expect(corridorValidationError(undefined)).toBeNull();
  });

  it("accepts a normalized corridor", () => {
    expect(corridorValidationError(corridor())).toBeNull();
  });

  it.each([
    ["not an object", "nope"],
    ["null", null],
    ["bad buffer", { ...corridor(), bufferMeters: Number.NaN }],
    ["negative buffer", { ...corridor(), bufferMeters: -1 }],
    ["oversized buffer", { ...corridor(), bufferMeters: MAX_CORRIDOR_METERS + 1 }],
    ["inverted bbox", { ...corridor(), bbox: [10, 10, -10, -10] }],
    ["off-globe bbox", { ...corridor(), bbox: [-181, 0, 10, 10] }],
    ["unknown coverage", { ...corridor(), coverage: "probably" }],
    ["bad timestamp", { ...corridor(), retrievedAt: "nonsense" }],
    ["line with one point", { ...corridor(), lines: [{ kind: "road", positions: [[0, 0]] }] }],
    ["line with bad position", { ...corridor(), lines: [{ kind: "road", positions: [[0, 0], [Number.NaN, 1]] }] }],
    ["unknown line kind", { ...corridor(), lines: [{ kind: "wormhole", positions: [[0, 0], [1, 1]] }] }],
    ["unknown point kind", { ...corridor(), points: [{ kind: "wormhole", lat: 0, lng: 0 }] }],
    ["non-array lines", { ...corridor(), lines: "x" }],
  ])("rejects %s", (_label, candidate) => {
    expect(corridorValidationError(candidate)).toBeTruthy();
  });

  it("returns a message a hiker can act on, not a type error", () => {
    const message = corridorValidationError({ ...corridor(), coverage: "probably" });
    expect(message).toMatch(/corridor/i);
    expect(message).not.toMatch(/undefined|TypeError|\bobject\b/);
  });
});

describe("corridorPositionCount", () => {
  it("counts line positions and points together", () => {
    expect(corridorPositionCount(corridor())).toBe(3);
  });
});

describe("truncation spends the budget on what gets a hiker out", () => {
  it("keeps roads when structures flood the corridor", () => {
    // Measured against a real corridor, generic structures outnumbered roads six
    // to one. In arrival order they would consume the budget and drop the road the
    // hiker needs to walk out on.
    const buildings = Array.from({ length: MAX_CORRIDOR_FEATURES * 2 }, (_, index) => ({
      kind: "building" as const,
      lat: 37.7 + index * 0.00001,
      lng: -119.5,
    }));
    const roads = Array.from({ length: 40 }, (_, index) => ({
      kind: "road" as const,
      name: `Road ${index}`,
      positions: [
        [-119.5, 37.7 + index * 0.001],
        [-119.49, 37.71 + index * 0.001],
      ] as GeoJSON.Position[],
    }));
    const result = normalizeCorridor({
      bufferMeters: DEFAULT_CORRIDOR_METERS,
      bbox: [-119.6, 37.7, -119.4, 37.85],
      // Buildings deliberately listed first, as Overpass ordering could deliver them.
      lines: roads,
      points: buildings,
    });
    expect(result.lines.filter((line) => line.kind === "road")).toHaveLength(40);
    expect(result.coverage).toBe("partial");
  });

  it("keeps shelters ahead of generic structures", () => {
    const points = [
      ...Array.from({ length: MAX_CORRIDOR_FEATURES }, (_, index) => ({
        kind: "building" as const,
        lat: 37.7 + index * 0.00001,
        lng: -119.5,
      })),
      { kind: "shelter" as const, name: "Emergency hut", lat: 37.8, lng: -119.45 },
    ];
    const result = normalizeCorridor({
      bufferMeters: DEFAULT_CORRIDOR_METERS,
      bbox: [-119.6, 37.7, -119.4, 37.85],
      lines: [],
      points,
    });
    expect(result.points.some((point) => point.kind === "shelter")).toBe(true);
  });

  it("prefers roads and water over trails and barriers under pressure", () => {
    const make = (kind: "road" | "water" | "trail" | "barrier", count: number) =>
      Array.from({ length: count }, (_, index) => ({
        kind,
        positions: [
          [-119.5, 37.7 + index * 0.0001],
          [-119.49, 37.71 + index * 0.0001],
        ] as GeoJSON.Position[],
      }));
    const result = normalizeCorridor({
      bufferMeters: DEFAULT_CORRIDOR_METERS,
      bbox: [-119.6, 37.7, -119.4, 37.85],
      lines: [...make("barrier", 3_000), ...make("trail", 3_000), ...make("road", 20), ...make("water", 20)],
      points: [],
    });
    expect(result.lines.filter((line) => line.kind === "road")).toHaveLength(20);
    expect(result.lines.filter((line) => line.kind === "water")).toHaveLength(20);
  });
});
