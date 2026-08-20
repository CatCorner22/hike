import { describe, expect, it } from "vitest";
import { bboxFromGeometry, formatDistance, formatDuration, formatElevation, formatPace } from "./index";
import { isLongitudeInInterval, minimumLongitudeInterval, unwrapLongitude } from "./antimeridian";
import { progressAlongTrail, safeBbox, trailLengthMeters } from "./navigation";
import { isFixNearRouteBbox } from "../safety/declination";

const dateline: GeoJSON.LineString = {
  type: "LineString",
  coordinates: [[179.9, 0], [-179.9, 0]],
};

describe("antimeridian invariants", () => {
  it("never exposes non-finite formatted navigation values", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      for (const formatted of [formatDistance(value), formatElevation(value), formatDuration(value), formatPace(value)]) {
        expect(formatted).not.toMatch(/NaN|Infinity|∞/);
      }
    }
  });

  it("uses the minimum circular interval for wrapped and ordinary routes", () => {
    const wrapped = minimumLongitudeInterval([179.9, -179.9])!;
    const ordinary = minimumLongitudeInterval([-120, -119])!;
    expect(wrapped).toMatchObject({ wrapsAntimeridian: true });
    expect(wrapped.maxLng - wrapped.minLng).toBeCloseTo(0.2, 6);
    expect(ordinary).toMatchObject({ minLng: -120, maxLng: -119, wrapsAntimeridian: false });
  });

  it("keeps a dateline bbox local and rejects a Greenwich fix", () => {
    const bbox = bboxFromGeometry(dateline, 0)!;
    const safe = safeBbox(dateline)!;
    expect(bbox[2] - bbox[0]).toBeLessThan(1);
    expect(safe[2] - safe[0]).toBeLessThan(1);
    expect(unwrapLongitude(-179.9, { minLng: safe[0], maxLng: safe[2] })).toBeGreaterThan(180);
    expect(isLongitudeInInterval(0, { minLng: safe[0], maxLng: safe[2] })).toBe(false);
    expect(isFixNearRouteBbox(0, 0, safe)).toBe(false);
    expect(trailLengthMeters(dateline)).toBeGreaterThan(22_000);
  });

  it("does not throw for corrupt geometry at public navigation entry points", () => {
    const corruptShapes: unknown[] = [
      { type: "LineString", coordinates: [[0, 0], [Number.NaN, 0]] },
      { type: "LineString", coordinates: [] },
      { type: "MultiLineString", coordinates: [[], [[0, 91], [1, 1]]] },
      { type: "MultiLineString", coordinates: "not-coordinates" },
    ];
    for (const shape of corruptShapes) {
      expect(() => bboxFromGeometry(shape as GeoJSON.LineString)).not.toThrow();
      expect(() => trailLengthMeters(shape as GeoJSON.LineString)).not.toThrow();
      expect(() => progressAlongTrail({ lat: 0, lng: 0 }, shape as GeoJSON.LineString)).not.toThrow();
    }
  });
});
