import { describe, expect, it } from "vitest";
import * as turf from "@turf/turf";
import { formatUsng, formatMgrs10, formatUtm, parseUsng, utmZone } from "./usng";

function metresApart(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  return turf.distance(turf.point([a.lng, a.lat]), turf.point([b.lng, b.lat]), {
    units: "meters",
  });
}

describe("USNG / UTM", () => {
  it("places Yosemite in UTM zone 11", () => {
    expect(utmZone(37.7459, -119.5936)).toBe(11);
  });

  it("places San Francisco in UTM zone 10", () => {
    expect(utmZone(37.7749, -122.4194)).toBe(10);
  });

  it("formats an 8-digit USNG grid for SAR", () => {
    const usng = formatUsng(37.7459, -119.5936);
    expect(usng).toMatch(/^\d{2}[C-HJ-NP-X] [A-Z]{2} \d{4} \d{4}$/);
  });

  // Regression: a trailing "N"/"S" for the hemisphere is read as an MGRS latitude band
  // by anyone plotting it — and band S is 32-40 N, so "11N" was actively misleading.
  it("labels UTM with the latitude band, not a hemisphere letter", () => {
    expect(formatUtm(37.7459, -119.5936)).toMatch(/^11S \d+ \d+$/);
  });
});

describe("parseUsng", () => {
  it("round-trips a 10-digit grid to within a metre", () => {
    const point = { lat: 37.7459, lng: -119.5936 };
    const parsed = parseUsng(formatMgrs10(point.lat, point.lng));
    expect(parsed).not.toBeNull();
    expect(metresApart(point, parsed!)).toBeLessThan(2);
  });

  /**
   * Regression, and the reason this file exists: northings repeat every 2 000 000 m, and
   * the old hint-based disambiguation always guessed "add" because it compared a
   * mod-2 000 000 residue against an absolute northing. Any pair straddling the
   * 4 000 000 m line — which runs through the southern Sierra at ~36.1 N — parsed
   * roughly 4 000 km away, into the Canadian Arctic.
   */
  it("resolves a grid on the far side of a 2 000 000 m northing boundary", () => {
    // Mount Whitney sits at northing ~4 048 000; this target, 62 km south, at ~3 986 000.
    const target = { lat: 36.02, lng: -118.3 };
    const parsed = parseUsng(formatMgrs10(target.lat, target.lng));
    expect(parsed).not.toBeNull();
    expect(metresApart(target, parsed!)).toBeLessThan(2);
  });

  it("does not need a GPS hint — the band letter resolves the northing", () => {
    const points = [
      { lat: 36.02, lng: -118.3 },
      { lat: 36.5785, lng: -118.2923 },
      { lat: 47.9, lng: -121.6 },
      { lat: 25.4, lng: -80.6 },
    ];
    for (const point of points) {
      const parsed = parseUsng(formatMgrs10(point.lat, point.lng));
      expect(parsed, `${point.lat},${point.lng}`).not.toBeNull();
      expect(metresApart(point, parsed!)).toBeLessThan(2);
    }
  });

  // Property test: every grid a SAR team could plausibly read out must round-trip,
  // wherever it sits relative to a 2 000 000 m northing boundary.
  it("round-trips everywhere across the contiguous US", () => {
    let worst = 0;
    for (let lat = 25.5; lat <= 48.5; lat += 0.37) {
      for (let lng = -123; lng <= -68; lng += 2.3) {
        const target = { lat, lng };
        const grid = formatMgrs10(lat, lng);
        const parsed = parseUsng(grid);
        expect(parsed, `${grid} for ${lat},${lng}`).not.toBeNull();
        worst = Math.max(worst, metresApart(target, parsed!));
      }
    }
    expect(worst).toBeLessThan(2);
  });

  it("round-trips in the southern hemisphere too", () => {
    for (const point of [
      { lat: -33.9, lng: -70.6 }, // Andes
      { lat: -12.4, lng: 130.8 }, // Top End
      { lat: -45.0, lng: 168.7 }, // Fiordland
    ]) {
      const parsed = parseUsng(formatMgrs10(point.lat, point.lng));
      expect(parsed, `${point.lat},${point.lng}`).not.toBeNull();
      expect(metresApart(point, parsed!)).toBeLessThan(2);
    }
  });

  it("truncated grids land inside the square they name", () => {
    const point = { lat: 37.7459, lng: -119.5936 };
    for (const digits of [4, 3, 2, 1] as const) {
      const parsed = parseUsng(formatUsng(point.lat, point.lng, digits));
      expect(parsed, `${digits} digits`).not.toBeNull();
      // 1 digit per axis names a 10 km square; the fix must be within its half-diagonal.
      expect(metresApart(point, parsed!)).toBeLessThan(10 ** (5 - digits) * 0.75);
    }
  });

  it("rejects grids that are not grids", () => {
    expect(parseUsng("not a grid")).toBeNull();
    expect(parseUsng("")).toBeNull();
    expect(parseUsng("11S LV 123")).toBeNull();
  });
});
