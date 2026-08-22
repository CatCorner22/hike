import { describe, expect, it } from "vitest";
import {
  deviceMagneticToTrueHeading,
  fuseNavHeading,
  headingAngularDifference,
  headingDisagreement,
  headingFromOrientationEvent,
  headingSourceLabel,
  magneticHeadingFromOrientationEvent,
  reduceDeviceOrientationHeadingSample,
  unavailableDeviceHeadingState,
} from "./device-heading";

describe("device heading", () => {
  it("marks iOS webkitCompassHeading as magnetic and converts it once", () => {
    const event = {
      webkitCompassHeading: 90,
      beta: 0,
      gamma: 0,
    } as unknown as DeviceOrientationEvent & { webkitCompassHeading: number };
    expect(magneticHeadingFromOrientationEvent(event, 0)).toEqual({
      degrees: 90,
      datum: "magnetic",
      source: "ios-webkit",
    });
    expect(
      headingFromOrientationEvent(event, {
        declinationDeg: 10,
        screenOrientationDeg: 0,
      }),
    ).toBe(100);
  });

  it("treats absolute alpha as magnetic before converting to true north", () => {
    expect(
      headingFromOrientationEvent(
        { absolute: true, alpha: 270, beta: 0, gamma: 0 } as DeviceOrientationEvent,
        { declinationDeg: -7, screenOrientationDeg: 0 },
      ),
    ).toBe(83);
  });

  it("refuses magnetic readings without declination instead of calling them true", () => {
    const event = {
      webkitCompassHeading: 90,
      beta: 0,
      gamma: 0,
    } as unknown as DeviceOrientationEvent & { webkitCompassHeading: number };
    expect(
      headingFromOrientationEvent(event, {
        declinationDeg: null,
        screenOrientationDeg: 0,
      }),
    ).toBeNull();
    expect(
      deviceMagneticToTrueHeading(
        { degrees: 90, datum: "magnetic", source: "ios-webkit" },
        null,
      ),
    ).toBeNull();
    expect(
      deviceMagneticToTrueHeading(
        { degrees: 90, datum: "magnetic", source: "ios-webkit" },
        91,
      ),
    ).toBeNull();
  });

  it("refuses landscape or tilted orientation rather than guessing a transform", () => {
    const flat = {
      webkitCompassHeading: 90,
      beta: 0,
      gamma: 0,
    } as unknown as DeviceOrientationEvent & { webkitCompassHeading: number };
    const edgeOfFlat = { ...flat, beta: 10 } as DeviceOrientationEvent & {
      webkitCompassHeading: number;
    };
    const tilted = { ...flat, beta: 10.1 } as DeviceOrientationEvent & {
      webkitCompassHeading: number;
    };
    expect(magneticHeadingFromOrientationEvent(flat, 90)).toBeNull();
    expect(magneticHeadingFromOrientationEvent(edgeOfFlat, 0)?.degrees).toBe(90);
    expect(magneticHeadingFromOrientationEvent(tilted, 0)).toBeNull();
  });

  it("keeps a valid absolute heading when an unusable relative stream fires next", () => {
    const absolute = reduceDeviceOrientationHeadingSample(
      unavailableDeviceHeadingState(null),
      { absolute: true, alpha: 270, beta: 0, gamma: 0 } as DeviceOrientationEvent,
      { declinationDeg: 10, screenOrientationDeg: 0 },
    );
    expect(absolute).toEqual({ headingTrue: 100, live: true, message: null });

    const relative = reduceDeviceOrientationHeadingSample(
      absolute,
      { absolute: false, alpha: 12, beta: 0, gamma: 0 } as DeviceOrientationEvent,
      { declinationDeg: 10, screenOrientationDeg: 0 },
    );
    expect(relative).toBe(absolute);
    expect(relative).toEqual({ headingTrue: 100, live: true, message: null });
  });

  it("still clears a retained heading when a trusted sample or prerequisite becomes invalid", () => {
    const valid = { headingTrue: 100, live: true, message: null };
    const malformedAbsolute = reduceDeviceOrientationHeadingSample(
      valid,
      { absolute: true, alpha: null, beta: 0, gamma: 0 } as DeviceOrientationEvent,
      { declinationDeg: 10, screenOrientationDeg: 0 },
    );
    expect(malformedAbsolute.headingTrue).toBeNull();
    expect(malformedAbsolute.live).toBe(false);
    expect(malformedAbsolute.message).toMatch(/hold the phone flat/i);

    const noDeclination = reduceDeviceOrientationHeadingSample(
      valid,
      { absolute: false, alpha: 12, beta: 0, gamma: 0 } as DeviceOrientationEvent,
      { declinationDeg: null, screenOrientationDeg: 0 },
    );
    expect(noDeclination.headingTrue).toBeNull();
    expect(noDeclination.live).toBe(false);
    expect(noDeclination.message).toMatch(/cannot be converted to true north/i);

    const permissionDenied = unavailableDeviceHeadingState(
      "Compass permission denied — using GPS course when moving.",
    );
    expect(permissionDenied).toEqual({
      headingTrue: null,
      live: false,
      message: "Compass permission denied — using GPS course when moving.",
    });
  });

  it("prefers device compass over GPS when both exist", () => {
    const fused = fuseNavHeading({ deviceTrue: 45, gpsCourseTrue: 90 });
    expect(fused).toEqual({ headingTrue: 45, source: "compass" });
  });

  it("uses manual heading in GPS-denied mode", () => {
    const fused = fuseNavHeading({
      gpsDenied: true,
      manualTrue: 180,
      deviceTrue: 45,
      gpsCourseTrue: 90,
    });
    expect(fused).toEqual({ headingTrue: 180, source: "manual" });
  });

  it("labels sources for the HUD", () => {
    expect(headingSourceLabel("compass")).toMatch(/compass/i);
  });

  it("measures angular difference across the 360° wrap", () => {
    expect(headingAngularDifference(350, 10)).toBe(20);
    expect(headingAngularDifference(10, 350)).toBe(20);
  });

  it("warns when compass and GPS diverge beyond threshold", () => {
    const warn = headingDisagreement({ compassTrue: 10, gpsCourseTrue: 90 });
    expect(warn.disagrees).toBe(true);
    expect(warn.deltaDeg).toBe(80);
    expect(warn.message).toMatch(/differ by 80°/);
    expect(headingDisagreement({ compassTrue: 10, gpsCourseTrue: 30 }).disagrees).toBe(false);
  });
});
