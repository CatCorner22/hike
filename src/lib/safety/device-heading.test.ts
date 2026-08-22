import { describe, expect, it } from "vitest";
import {
  deviceMagneticToTrueHeading,
  fuseNavHeading,
  headingAngularDifference,
  headingDisagreement,
  headingFromOrientationEvent,
  headingSourceLabel,
  magneticHeadingFromOrientationEvent,
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
