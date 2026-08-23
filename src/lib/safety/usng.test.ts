import { describe, expect, it } from "vitest";
import * as turf from "@turf/turf";
import { formatDdm, formatDms, formatUsng, formatMgrs10, formatUtm, parseUsng, utmZone } from "./usng";

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
    const usng = formatUsng(37.7459, -119.5936)!;
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

/**
 * These two functions had no test anywhere in the repo, after twenty-one
 * adversarial passes — and their output is what gets read over a handheld radio
 * to a rescuer, and what goes into the medevac 9-line.
 */
describe("degrees-minutes-seconds and degrees-decimal-minutes", () => {
  const COMPONENT = /(\d+)°(\d+(?:\.\d+)?)'(?:([\d.]+)")?([NSEW])/g;

  function parseBack(text: string): Array<{ value: number; hemi: string }> {
    COMPONENT.lastIndex = 0;
    const out: Array<{ value: number; hemi: string }> = [];
    let match: RegExpExecArray | null;
    while ((match = COMPONENT.exec(text))) {
      const degrees = Number(match[1]);
      const minutes = Number(match[2]);
      const seconds = match[3] ? Number(match[3]) : 0;
      const magnitude = degrees + minutes / 60 + seconds / 3600;
      out.push({ value: match[4] === "S" || match[4] === "W" ? -magnitude : magnitude, hemi: match[4] });
    }
    return out;
  }

  /**
   * Regression: `(37.749999 - 37) * 60 = 44.99994`, whose seconds round to
   * "60.0". The old code printed the rounded component without carrying, so it
   * emitted `37°44'60.0"N` — not a coordinate. A call-taker who cannot enter it
   * re-reads it as 44'06", which is 54 arcseconds of latitude: about 1.67 km,
   * usually the wrong side of a drainage.
   */
  it("carries instead of printing a sixtieth minute or second", () => {
    expect(formatDms(37.749999, -119.6032)).toBe(`37°45'0.0"N 119°36'11.5"W`);
    expect(formatDms(37.99999999, -119.9999999)).toBe(`38°00'0.0"N 120°00'0.0"W`);
    expect(formatDdm(37.99999999, -119.9999999)).toBe("38°0.000'N 120°0.000'W");
    // The carry must run all the way up, not just one place.
    expect(formatDms(89.99999999, 179.99999999)).toBe(`90°00'0.0"N 180°00'0.0"E`);
  });

  it("never emits an invalid component, over the whole coordinate space", () => {
    const offenders: string[] = [];
    // Deterministic sweep rather than random sampling: walk the last arcminute
    // of a degree in fine steps, which is where every rollover lives.
    for (let degree = -89; degree <= 89; degree += 7) {
      for (let step = 0; step < 600; step += 1) {
        const lat = degree + (59 * 60 + 30 + step / 20) / 3600;
        if (lat > 90 || lat < -90) continue;
        const lng = (degree * 2 + (59 * 60 + 30 + step / 20) / 3600) % 180;
        for (const text of [formatDms(lat, lng), formatDdm(lat, lng)]) {
          if (/'60(\.0+)?"/.test(text) || /°60(\.0+)?'/.test(text)) offenders.push(text);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("stays within its own printed precision when read back", () => {
    // 0.1" is ~3.1 m, so a correct formatter is never off by more than half of
    // that. This is the guarantee a rescuer is relying on.
    for (const [lat, lng] of [
      [37.749999, -119.6032],
      [36.0996, -112.1123],
      [-33.8688, 151.2093],
      [64.1466, -21.9426],
      [0.00001, -0.00001],
    ] as const) {
      const [gotLat, gotLng] = parseBack(formatDms(lat, lng));
      expect(Math.abs(gotLat.value - lat) * 111_320).toBeLessThan(1.6);
      expect(Math.abs(gotLng.value - lng) * 111_320).toBeLessThan(1.6);
    }
  });

  it("refuses positions it cannot express", () => {
    expect(formatDms(Number.NaN, 0)).toBe("—");
    expect(formatDdm(91, 0)).toBe("—");
  });
});
