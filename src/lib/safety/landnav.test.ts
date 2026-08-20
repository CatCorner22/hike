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
  intersection,
  resection,
  resection3,
  timeSpeedDistance,
  deadReckonUncertaintyM,
  fixUncertaintyM,
  greatCircleFix,
} from "./landnav";
import { gmAngleCard, toTrueBearing } from "./declination";
import { formatMgrs10, parseUsng, phonetic } from "./usng";
import { nineLineMedevac } from "./medevac";
import * as turf from "@turf/turf";

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
    const dest = deadReckon({ lat: 37.0, lng: -119.0 }, 0, 1000)!;
    expect(dest.lat).toBeGreaterThan(37.008);
    expect(dest.lng).toBeCloseTo(-119.0, 3);
  });

  it("converts pace count to meters", () => {
    expect(distanceFromPaces(65, 65)).toBeCloseTo(100);
  });

  it("gives range and azimuth between two points", () => {
    const ra = rangeAzimuth({ lat: 37.0, lng: -119.0 }, { lat: 37.01, lng: -119.0 })!;
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
    const off = deliberateOffset(from, to, 100, "right")!;
    expect(off.catchTurn).toBe("left");
    expect(off.aim.lng).toBeGreaterThan(to.lng);
    expect(off.headingTrue).toBeGreaterThan(0);
    expect(off.headingTrue).toBeLessThan(30);
  });

  it("boxes around an obstacle and resumes on the original line", () => {
    const start = { lat: 37.0, lng: -119.0 };
    const box = obstacleBox(start, 0, 50, 100, "right")!;
    const back = rangeAzimuth(start, box.resume)!;
    expect(back.meters).toBeGreaterThan(90);
    expect(back.meters).toBeLessThan(120);
    expect(back.trueDeg === 0 || back.trueDeg > 350).toBe(true);
  });

  it("computes a course correction toward the destination", () => {
    expect(courseCorrection(100, 100)).toBeCloseTo(45, 0);
    expect(courseCorrection(0, 200)).toBe(0);
  });

  it("triangulates with three-point resection", () => {
    const here = { lat: 37.0, lng: -119.0 };
    const north = { lat: 37.01, lng: -119.0 };
    const east = { lat: 37.0, lng: -118.99 };
    const south = { lat: 36.99, lng: -119.0 };
    const fix = resection3([
      { known: north, bearingTo: 0 },
      { known: east, bearingTo: 90 },
      { known: south, bearingTo: 180 },
    ]);
    expect(fix).not.toBeNull();
    expect(fix!.point.lat).toBeCloseTo(here.lat, 2);
    expect(fix!.point.lng).toBeCloseTo(here.lng, 2);
  });

  it("solves time-speed-distance", () => {
    const tsd = timeSpeedDistance({ distanceM: 5000, speedKph: 5 });
    expect(tsd).not.toBeNull();
    expect(tsd!.minutes).toBeCloseTo(60, 0);
  });

  it("intersects two observer rays on an unknown point", () => {
    const target = { lat: 37.0, lng: -119.0 };
    const west = { lat: 37.0, lng: -119.01 };
    const south = { lat: 36.99, lng: -119.0 };
    const hit = intersection(west, 90, south, 0);
    expect(hit).not.toBeNull();
    expect(hit!.point.lat).toBeCloseTo(target.lat, 3);
    expect(hit!.point.lng).toBeCloseTo(target.lng, 3);
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
    const grid = formatMgrs10(origin.lat, origin.lng)!;
    const parsed = parseUsng(grid, origin);
    expect(parsed).not.toBeNull();
    const ra = rangeAzimuth(origin, parsed!)!;
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

describe("timeSpeedDistance", () => {
  it("solves for the missing value", () => {
    expect(timeSpeedDistance({ distanceM: 5000, speedKph: 5 })!.minutes).toBeCloseTo(60);
    expect(timeSpeedDistance({ distanceM: 5000, minutes: 60 })!.speedKph).toBeCloseTo(5);
    expect(timeSpeedDistance({ speedKph: 5, minutes: 60 })!.distanceM).toBeCloseTo(5000);
  });

  it("needs two of the three", () => {
    expect(timeSpeedDistance({ distanceM: 5000 })).toBeNull();
    expect(timeSpeedDistance({})).toBeNull();
  });

  // Regression: a zero did not count towards the "have two values" gate but was still
  // consumed by the first branch, which silently discarded the minutes it was given.
  it("treats a zero as missing, not as a supplied value", () => {
    const solved = timeSpeedDistance({ distanceM: 0, speedKph: 5, minutes: 10 });
    expect(solved).not.toBeNull();
    expect(solved!.minutes).toBe(10);
    expect(solved!.distanceM).toBeCloseTo((5 * 10) / 60 * 1000);
  });
});

/** deadReckon is nullable on invalid input; these fixtures are all valid. */
function at(start: { lat: number; lng: number }, heading: number, metres: number) {
  const point = deadReckon(start, heading, metres);
  if (!point) throw new Error(`deadReckon returned null for ${heading}deg / ${metres}m`);
  return point;
}

/**
 * Bearing fixes used to be cut with turf.lineIntersect, a *planar* crossing of
 * raw lng/lat degrees, while the rays themselves were great circles. The bias
 * grew with range and latitude and pointed the same way for every pair, so the
 * three-point spread stayed small while the fix drifted. These cases are
 * measured against a truth position with perfect, error-free bearings: any
 * residual here is the code, not the compass.
 */
describe("bearing fix geometry", () => {
  const bearingTo = (from: { lat: number; lng: number }, to: { lat: number; lng: number }) =>
    (turf.bearing(turf.point([from.lng, from.lat]), turf.point([to.lng, to.lat])) + 360) % 360;
  const metresApart = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
    turf.distance(turf.point([a.lng, a.lat]), turf.point([b.lng, b.lat]), { units: "meters" });

  it("resects the exact position from exact bearings, at range and at latitude", () => {
    // Previously: 65 m out at 10 km / 37.7 N, 328 m at 20 km / 61.2 N,
    // 1412 m at 50 km / 70 N.
    for (const truth of [
      { lat: 37.7, lng: -119.6 },
      { lat: 61.2, lng: -149.9 },
      { lat: 70.0, lng: -150.0 },
      { lat: -41.3, lng: 174.8 },
      { lat: 0, lng: -70 },
      { lat: 37.7, lng: 179.98 },
    ]) {
      for (const rangeM of [1_000, 10_000, 20_000, 50_000]) {
        const a = at(truth, 20, rangeM);
        const b = at(truth, 110, rangeM);
        const fix = resection(a, bearingTo(truth, a), b, bearingTo(truth, b));
        expect(fix, `${truth.lat} @ ${rangeM} m`).not.toBeNull();
        expect(metresApart(truth, fix!.point), `${truth.lat} @ ${rangeM} m`).toBeLessThan(1);
      }
    }
  });

  it("intersects two observer rays on the exact unknown", () => {
    const target = { lat: 61.2, lng: -149.9 };
    const a = at(target, 200, 18_000);
    const b = at(target, 290, 18_000);
    const hit = intersection(a, bearingTo(a, target), b, bearingTo(b, target));
    expect(hit).not.toBeNull();
    expect(metresApart(target, hit!.point)).toBeLessThan(1);
  });

  it("refuses a cut that is parallel, behind the shooter, or past sight range", () => {
    const a = { lat: 37.7, lng: -119.6 };
    const b = { lat: 37.7, lng: -119.5 };
    expect(greatCircleFix(a, 90, b, 90)).toBeNull();
    expect(greatCircleFix(a, Number.NaN, b, 90)).toBeNull();
    // Both rays head away from the crossing.
    expect(greatCircleFix(a, 270, b, 90, 80_000)).toBeNull();
    const far = at(a, 45, 900_000);
    expect(greatCircleFix(a, 45, far, 225)).toBeNull();
  });
});

/**
 * The cocked-hat trap: how tightly three cuts close says almost nothing about
 * how far the fix is from the party. Bearings off by 0, +3 and -3 degrees put
 * all three cuts within half a metre of each other, 499 m from the truth — and
 * the readout called that "Fix spread ~0 m" with no warning.
 */
describe("resection confidence", () => {
  const bearingTo = (from: { lat: number; lng: number }, to: { lat: number; lng: number }) =>
    (turf.bearing(turf.point([from.lng, from.lat]), turf.point([to.lng, to.lat])) + 360) % 360;
  const metresApart = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
    turf.distance(turf.point([a.lng, a.lat]), turf.point([b.lng, b.lat]), { units: "meters" });

  it("does not let three agreeing cuts understate a fix that is far off", () => {
    const truth = { lat: 37.7, lng: -119.6 };
    const known = [30, 150, 270].map((brg) => at(truth, brg, 8_000));
    const fix = resection3([
      { known: known[0], bearingTo: bearingTo(truth, known[0]) },
      { known: known[1], bearingTo: (bearingTo(truth, known[1]) + 3) % 360 },
      { known: known[2], bearingTo: (bearingTo(truth, known[2]) + 357) % 360 },
    ]);
    expect(fix).not.toBeNull();
    const actualError = metresApart(truth, fix!.point);
    // The trap itself: the cuts really do agree, and the fix really is far off.
    expect(fix!.spreadM).toBeLessThan(5);
    expect(actualError).toBeGreaterThan(400);
    // The quoted radius has to cover it anyway, because it comes from the
    // geometry rather than from the agreement.
    expect(fix!.uncertaintyM).not.toBeNull();
    expect(fix!.uncertaintyM!).toBeGreaterThan(actualError);
  });

  it("quotes a radius that grows with range and with a shallow cut", () => {
    const near = fixUncertaintyM(2_000, 2_000, 90)!;
    const far = fixUncertaintyM(20_000, 20_000, 90)!;
    const shallow = fixUncertaintyM(2_000, 2_000, 10)!;
    expect(far / near).toBeCloseTo(10, 1);
    expect(shallow).toBeGreaterThan(near * 5);
    // 2 km known points, square cut: hundreds of metres, not tens.
    expect(near).toBeGreaterThan(150);
    expect(near).toBeLessThan(400);
    expect(fixUncertaintyM(2_000, 2_000, 0)).toBeNull();
    expect(fixUncertaintyM(Number.NaN, 2_000, 90)).toBeNull();
  });

  it("carries a radius on two-point and intersection fixes too", () => {
    const truth = { lat: 37.0, lng: -119.0 };
    const a = at(truth, 20, 4_000);
    const b = at(truth, 110, 4_000);
    const fix = resection(a, bearingTo(truth, a), b, bearingTo(truth, b));
    expect(fix!.uncertaintyM).toBeGreaterThan(0);
    const hit = intersection(a, bearingTo(a, truth), b, bearingTo(b, truth));
    expect(hit!.uncertaintyM).toBeGreaterThan(0);
  });
});

describe("land-nav readouts that must not mislead", () => {
  it("reports a full circle as north rather than 6400 mils", () => {
    expect(degreesToMils(359.99)).toBe(0);
    expect(degreesToMils(360)).toBe(0);
    expect(degreesToMils(0)).toBe(0);
    for (let d = 0; d < 360; d += 0.37) {
      const mils = degreesToMils(d)!;
      expect(mils).toBeGreaterThanOrEqual(0);
      expect(mils).toBeLessThan(6400);
    }
  });

  it("never shrinks the dead-reckon ring as the heading error widens", () => {
    let previous = 0;
    for (const headingErrorDeg of [0, 15, 45, 80, 89, 90, 120, 179, 400]) {
      const ring = deadReckonUncertaintyM({ distanceM: 1_000, lastAccuracyM: 10, headingErrorDeg });
      expect(Number.isFinite(ring), `${headingErrorDeg} deg`).toBe(true);
      expect(ring, `${headingErrorDeg} deg`).toBeGreaterThanOrEqual(previous);
      previous = ring;
    }
    // Past 90 deg tan() went infinite and then negative: a 120 deg heading
    // error reported a ring of -1622 m, and 179 deg reported less than 15 deg.
    expect(deadReckonUncertaintyM({ distanceM: 1_000, lastAccuracyM: 10, headingErrorDeg: 120 }))
      .toBeGreaterThan(deadReckonUncertaintyM({ distanceM: 1_000, lastAccuracyM: 10, headingErrorDeg: 15 }));
  });

  it("does not tell the party to turn when no offset was applied", () => {
    const from = { lat: 37.0, lng: -119.0 };
    const to = { lat: 37.01, lng: -119.0 };
    // A negative or non-finite offset is refused outright.
    for (const offset of [-100, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(deliberateOffset(from, to, offset, "right"), `${offset}`).toBeNull();
    }
    // Zero still resolves, and must not invent a side to turn toward.
    const zero = deliberateOffset(from, to, 0, "right");
    expect(zero).not.toBeNull();
    expect(zero!.label).not.toMatch(/turn (left|right)/i);
    expect(zero!.aim.lat).toBeCloseTo(to.lat, 6);
    expect(zero!.aim.lng).toBeCloseTo(to.lng, 6);
    expect(deliberateOffset(from, to, 100, "right")!.label).toMatch(/turn left/i);
  });
});

describe("dead reckoning across the antimeridian", () => {
  /**
   * turf.destination walks straight past +/-180 rather than wrapping, so every leg
   * that crossed the seam came back as e.g. 180.019 and was thrown away by the
   * on-globe validator. Dead reckoning returned null for the whole crossing — in the
   * western Aleutians, Fiji and the Chathams — with no GPS to fall back on, which is
   * the only situation dead reckoning exists for.
   */
  it("wraps rather than discarding a leg that crosses the seam", () => {
    for (const [lat, lng, heading, metres] of [
      [37.7, 179.98, 20, 10_000],
      [51.9, 179.9, 90, 20_000],
      [-16.5, -179.95, 270, 15_000],
      [52.0, -179.99, 270, 5_000],
    ] as const) {
      const point = deadReckon({ lat, lng }, heading, metres);
      expect(point, `${lat},${lng} ${heading}deg`).not.toBeNull();
      expect(Math.abs(point!.lng), `${lat},${lng}`).toBeLessThanOrEqual(180);
      expect(Math.abs(point!.lat)).toBeLessThanOrEqual(90);
      // The wrapped point is still the right distance away.
      const back = rangeAzimuth({ lat, lng }, point!);
      expect(back).not.toBeNull();
      expect(back!.meters, `${lat},${lng}`).toBeCloseTo(metres, -1);
    }
  });

  it("still refuses genuinely invalid input", () => {
    expect(deadReckon({ lat: 37, lng: -119 }, Number.NaN, 100)).toBeNull();
    expect(deadReckon({ lat: 37, lng: -119 }, 20, -100)).toBeNull();
    expect(deadReckon({ lat: Number.NaN, lng: -119 }, 20, 100)).toBeNull();
  });
});
