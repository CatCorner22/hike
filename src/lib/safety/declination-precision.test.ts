import { describe, expect, it } from "vitest";
import {
  DECLINATION_MODEL_EPOCH,
  DECLINATION_UNCERTAINTY_DEG,
  formatWalkBearing,
  gmAngleCard,
  magneticDeclination,
  magneticDeclinationEstimate,
} from "./declination";
import { headingDisagreement } from "./device-heading";

/** Yosemite Valley, where the published field is about +12.4 degrees east. */
const YOSEMITE = { lat: 37.75, lng: -119.6 };

/**
 * The model is whole degrees sampled on ten-degree cells. It was rendering a
 * tenth of a degree — "subtract 15.0°" on the navigate screen — which is about
 * twenty times the precision the source can carry, and it read as a surveyed
 * figure to anyone standing over a map.
 */
describe("the declination model claims only the precision it has", () => {
  it("returns whole degrees", () => {
    const estimate = magneticDeclinationEstimate(YOSEMITE.lat, YOSEMITE.lng);
    expect(estimate).not.toBeNull();
    expect(Number.isInteger(estimate!.degrees)).toBe(true);
    expect(Number.isInteger(magneticDeclination(YOSEMITE.lat, YOSEMITE.lng)!)).toBe(true);
  });

  it("states an uncertainty wide enough to contain its own known error", () => {
    const estimate = magneticDeclinationEstimate(YOSEMITE.lat, YOSEMITE.lng)!;
    // The published value here is about 12.4; the model says 13. The stated
    // uncertainty has to cover that gap or it is decoration.
    expect(Math.abs(estimate.degrees - 12.4)).toBeLessThanOrEqual(estimate.uncertaintyDeg);
    expect(estimate.uncertaintyDeg).toBeGreaterThanOrEqual(DECLINATION_UNCERTAINTY_DEG);
  });

  it("widens the uncertainty as the model ages", () => {
    const atEpoch = magneticDeclinationEstimate(
      YOSEMITE.lat,
      YOSEMITE.lng,
      new Date(Date.UTC(DECLINATION_MODEL_EPOCH, 0, 2)),
    )!;
    const muchLater = magneticDeclinationEstimate(
      YOSEMITE.lat,
      YOSEMITE.lng,
      new Date(Date.UTC(DECLINATION_MODEL_EPOCH + 20, 0, 2)),
    )!;
    expect(muchLater.uncertaintyDeg).toBeGreaterThan(atEpoch.uncertaintyDeg);
    // ...and the value itself does not drift, because the table cannot know that.
    expect(muchLater.degrees).toBe(atEpoch.degrees);
  });

  it("prints no tenths on the grid-magnetic card, and says how far off it may be", () => {
    const card = gmAngleCard(YOSEMITE.lat, YOSEMITE.lng);
    expect(card.gridToMagnetic).not.toMatch(/\d\.\d°/);
    expect(card.magneticToGrid).not.toMatch(/\d\.\d°/);
    expect(card.gridToMagnetic).toMatch(/±\d+°/);
    expect(card.uncertaintyDeg).toBe(magneticDeclinationEstimate(YOSEMITE.lat, YOSEMITE.lng)!.uncertaintyDeg);
  });

  it("carries the uncertainty onto a walking bearing too", () => {
    expect(formatWalkBearing(90, YOSEMITE.lat, YOSEMITE.lng)).toMatch(/±\d+° magnetic/);
    // With no position there is no declination and nothing to qualify.
    expect(formatWalkBearing(90)).toBe("90° true");
  });

  it("says which direction LARS converts, since it is read with a compass in hand", () => {
    expect(gmAngleCard(YOSEMITE.lat, YOSEMITE.lng).lars).toMatch(/grid → magnetic/i);
  });

  it("still refuses to convert outside its coverage rather than guessing", () => {
    // Central Europe: no coverage in this table.
    expect(magneticDeclinationEstimate(48, 11)).toBeNull();
    const card = gmAngleCard(48, 11);
    expect(card.gmAngle).toBeNull();
    expect(card.uncertaintyDeg).toBeNull();
    expect(card.gridToMagnetic).toMatch(/unavailable here/i);
  });
});

/**
 * The disagreement gate exists to catch a declination sign error — reading east
 * as west. Over the western US that produces 12 to 27 degrees of discrepancy,
 * and the threshold was 45, so every sign error passed silently under the one
 * check built to catch it.
 */
describe("the compass-versus-GPS gate catches the error it was built for", () => {
  it("flags a sign error at the small end of what the terrain produces", () => {
    // 13 degrees east read as west: 26 degrees of disagreement.
    const result = headingDisagreement({ compassTrue: 0, gpsCourseTrue: 26 });
    expect(result.disagrees).toBe(true);
    expect(result.message).toMatch(/differ by 26°/);
  });

  it("stays quiet for ordinary GPS course noise at walking pace", () => {
    expect(headingDisagreement({ compassTrue: 0, gpsCourseTrue: 12 }).disagrees).toBe(false);
  });

  it("says nothing when either heading is missing", () => {
    expect(headingDisagreement({ compassTrue: null, gpsCourseTrue: 90 })).toEqual({
      disagrees: false,
      deltaDeg: null,
      message: null,
    });
  });
});
