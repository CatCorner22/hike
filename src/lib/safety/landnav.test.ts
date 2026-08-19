import { describe, expect, it } from "vitest";
import { backAzimuth, deadReckon, degreesToMils, distanceFromPaces, rangeAzimuth } from "./landnav";
import { formatMgrs10, parseUsng, phonetic } from "./usng";
import { nineLineMedevac } from "./medevac";

describe("land nav math", () => {
  it("converts degrees to NATO mils", () => {
    expect(degreesToMils(0)).toBe(0);
    expect(degreesToMils(180)).toBe(3200);
    expect(degreesToMils(360)).toBe(0);
  });

  it("computes a back azimuth", () => {
    expect(backAzimuth(40)).toBe(220);
    expect(backAzimuth(200)).toBe(20);
  });

  it("dead-reckons about 1 km due north", () => {
    const dest = deadReckon({ lat: 37.0, lng: -119.0 }, 0, 1000);
    expect(dest.lat).toBeGreaterThan(37.008);
    expect(dest.lng).toBeCloseTo(-119.0, 3);
  });

  it("converts pace count to meters", () => {
    expect(distanceFromPaces(65, 65)).toBeCloseTo(100);
  });

  it("gives range and azimuth between two points", () => {
    const ra = rangeAzimuth({ lat: 37.0, lng: -119.0 }, { lat: 37.01, lng: -119.0 });
    expect(ra.meters).toBeGreaterThan(1000);
    expect(ra.trueDeg === 0 || ra.trueDeg > 350).toBe(true);
  });
});

describe("MGRS parse / phonetic", () => {
  it("round-trips a Yosemite grid within 25 m", () => {
    const origin = { lat: 37.7459, lng: -119.5936 };
    const grid = formatMgrs10(origin.lat, origin.lng);
    const parsed = parseUsng(grid, origin);
    expect(parsed).not.toBeNull();
    const ra = rangeAzimuth(origin, parsed!);
    expect(ra.meters).toBeLessThan(25);
  });

  it("speaks a grid in NATO phonetics", () => {
    expect(phonetic("11S")).toContain("Sierra");
    expect(phonetic("11S")).toContain("One");
  });
});

describe("9-line", () => {
  it("includes location and precedence lines", () => {
    const text = nineLineMedevac({
      lat: 37.7459,
      lng: -119.5936,
      trailName: "Mist Trail",
      profile: { name: "Pat", iceName: "", icePhone: "", medical: "bee sting", partySize: 2 },
    });
    expect(text).toContain("L1 LOCATION");
    expect(text).toContain("L3 PATIENTS");
    expect(text).toContain("Mist Trail");
  });
});
