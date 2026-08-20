import { describe, expect, it } from "vitest";
import {
  formatWalkBearing,
  gmAngleCard,
  gridConvergence,
  isFixNearRouteBbox,
  magneticDeclination,
  toMagneticBearing,
  turnaroundWarning,
} from "./declination";
import { naismithMinutes } from "./pace";

describe("magneticDeclination", () => {
  it("is east of true north in the Sierra", () => {
    const d = magneticDeclination(37.7, -119.6);
    expect(d).not.toBeNull();
    expect(d!).toBeGreaterThan(8);
    expect(d!).toBeLessThan(18);
  });

  it("is west of true north in New England", () => {
    const d = magneticDeclination(42.4, -71.1);
    expect(d).not.toBeNull();
    expect(d!).toBeLessThan(-8);
  });

  it("converts true bearings to magnetic for a compass", () => {
    expect(toMagneticBearing(40, 13)).toBe(27);
    expect(formatWalkBearing(40, 37.7, -119.6)).toMatch(/true/);
    expect(formatWalkBearing(40, 37.7, -119.6)).toMatch(/magnetic/);
  });
});

describe("turnaroundWarning", () => {
  it("warns when remaining time exceeds daylight", () => {
    expect(turnaroundWarning(8000, 0, 20, false)).toMatch(/Turn around/);
  });

  it("stays quiet when there is enough daylight", () => {
    expect(turnaroundWarning(1000, 0, 90, false)).toBeNull();
    expect(turnaroundWarning(8000, 0, 20, true)).toBeNull();
  });

  // Regression: the warning used to assume a flat 5 km/h with no climb allowance and a
  // 10-minute grace, so it stayed silent while the screen beside it printed a Naismith
  // estimate that did not fit in the remaining daylight.
  it("agrees with the Naismith estimate shown on the same screen", () => {
    const cases: Array<[number, number, number]> = [
      [6000, 500, 95],
      [4000, 900, 100],
      [12000, 0, 140],
      [2000, 50, 200],
      [9000, 1200, 240],
    ];
    for (const [remainingM, gainM, minutesLeft] of cases) {
      const needed = naismithMinutes(remainingM, gainM);
      const warning = turnaroundWarning(remainingM, gainM, minutesLeft, false);
      expect(Boolean(warning), `${remainingM} m / ${gainM} m gain / ${minutesLeft} min left`).toBe(
        needed > minutesLeft,
      );
    }
  });

  it("counts remaining climb, not just distance", () => {
    // 6 km alone fits in 95 min; 6 km plus 500 m of climb does not.
    expect(turnaroundWarning(6000, 0, 95, false)).toBeNull();
    expect(turnaroundWarning(6000, 500, 95, false)).toMatch(/Turn around/);
  });

  it("speaks up once the sun is already down", () => {
    expect(turnaroundWarning(3000, 0, -15, false)).toMatch(/already down/);
  });
});

describe("bearings rendered to the user", () => {
  // Regression: turf.bearing returns -180..180 and formatWalkBearing printed it raw,
  // so the OFF TRAIL banner could read "Walk -122° true" — not a heading you can set.
  it("never renders a negative or out-of-range heading", () => {
    for (let bearing = -180; bearing <= 180; bearing += 7) {
      for (const where of [[37.7, -119.6], [42.4, -71.1], [null, null]] as const) {
        const label = formatWalkBearing(bearing, where[0] ?? undefined, where[1] ?? undefined);
        for (const [, degrees] of label.matchAll(/(-?\d+)°/g)) {
          expect(Number(degrees), label).toBeGreaterThanOrEqual(0);
          expect(Number(degrees), label).toBeLessThan(360);
        }
      }
    }
  });
});

describe("gmAngleCard", () => {
  // Regression: the card used declination alone as the G-M angle, ignoring UTM grid
  // convergence — up to ~3° at a zone edge, in a workflow that plots on USNG.
  it("folds grid convergence into the G-M angle", () => {
    const card = gmAngleCard(37.7, -119.6);
    // Inside the model's coverage every component is known, so a null here is
    // itself the failure.
    expect(card.declination).not.toBeNull();
    expect(card.convergence).not.toBeNull();
    expect(card.gmAngle).toBeCloseTo(card.declination! - card.convergence!, 6);
    expect(card.convergence).not.toBe(0);
  });

  it("has no convergence on a zone central meridian", () => {
    // Zone 11 runs 120W-114W, central meridian 117W.
    expect(gridConvergence(40, -117)).toBeCloseTo(0, 6);
  });

  it("flips convergence sign either side of the central meridian", () => {
    expect(gridConvergence(40, -115)).toBeGreaterThan(0);
    expect(gridConvergence(40, -119)).toBeLessThan(0);
  });
});

describe("isFixNearRouteBbox", () => {
  const yosemite: [number, number, number, number] = [-119.7, 37.6, -119.4, 37.8];

  it("accepts a fix on the trail", () => {
    expect(isFixNearRouteBbox(37.7, -119.55, yosemite)).toBe(true);
  });

  it("rejects a last-known fix from another region", () => {
    expect(isFixNearRouteBbox(37.77, -122.42, yosemite)).toBe(false);
  });
});
