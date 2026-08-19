import { describe, expect, it } from "vitest";
import {
  backAzimuth,
  courseCorrection,
  deadReckon,
  deliberateOffset,
  degreesToMils,
  distanceFromPaces,
  milRelationRange,
  obstacleBox,
  rangeAzimuth,
  resection,
} from "./landnav";
import { gmAngleCard, toTrueBearing } from "./declination";
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

  it("applies terrain to pace distance", () => {
    expect(distanceFromPaces(65, 65, "flat")).toBeCloseTo(100);
    expect(distanceFromPaces(65, 65, "up")).toBeLessThan(95);
  });

  it("uses the mil relation for landmark range", () => {
    expect(milRelationRange(1.8, 10)).toBeCloseTo(180);
    expect(milRelationRange(2, 0)).toBeNull();
  });

  it("resects a position from two known points", () => {
    const here = { lat: 37.0, lng: -119.0 };
    const north = { lat: 37.01, lng: -119.0 };
    const east = { lat: 37.0, lng: -118.99 };
    const fix = resection(north, 0, east, 90);
    expect(fix).not.toBeNull();
    expect(fix!.point.lat).toBeCloseTo(here.lat, 3);
    expect(fix!.point.lng).toBeCloseTo(here.lng, 3);
    expect(fix!.cutDeg).toBeCloseTo(90, 0);
  });

  it("aims off a destination with a deliberate offset", () => {
    const from = { lat: 37.0, lng: -119.0 };
    const to = { lat: 37.01, lng: -119.0 };
    const off = deliberateOffset(from, to, 100, "right");
    expect(off.catchTurn).toBe("left");
    expect(off.aim.lng).toBeGreaterThan(to.lng);
    expect(off.headingTrue).toBeGreaterThan(0);
    expect(off.headingTrue).toBeLessThan(30);
  });

  it("boxes around an obstacle and resumes on the original line", () => {
    const start = { lat: 37.0, lng: -119.0 };
    const box = obstacleBox(start, 0, 50, 100, "right");
    const back = rangeAzimuth(start, box.resume);
    expect(back.meters).toBeGreaterThan(90);
    expect(back.meters).toBeLessThan(120);
    expect(back.trueDeg === 0 || back.trueDeg > 350).toBe(true);
  });

  it("computes a course correction toward the destination", () => {
    expect(courseCorrection(100, 100)).toBeCloseTo(45, 0);
    expect(courseCorrection(0, 200)).toBe(0);
  });
});

describe("G-M card", () => {
  it("converts magnetic to true with east declination", () => {
    expect(toTrueBearing(10, 12)).toBeCloseTo(22);
    const card = gmAngleCard(37.7, -119.6);
    expect(card).not.toBeNull();
    expect(card!.gridToMagnetic).toMatch(/Grid/);
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
