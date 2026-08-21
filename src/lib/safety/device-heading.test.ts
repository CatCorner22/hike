import { describe, expect, it } from "vitest";
import {
  fuseNavHeading,
  headingAngularDifference,
  headingDisagreement,
  headingFromOrientationEvent,
  headingSourceLabel,
} from "./device-heading";

describe("device heading", () => {
  it("reads iOS webkitCompassHeading", () => {
    expect(
      headingFromOrientationEvent({ webkitCompassHeading: 90 } as unknown as DeviceOrientationEvent),
    ).toBe(90);
  });

  it("reads absolute alpha as true north", () => {
    expect(
      headingFromOrientationEvent({ absolute: true, alpha: 270 } as DeviceOrientationEvent),
    ).toBe(90);
  });

  it("prefers device compass over GPS when both exist", () => {
    const fused = fuseNavHeading({ device: 45, gps: 90 });
    expect(fused).toEqual({ heading: 45, source: "compass" });
  });

  it("uses manual heading in GPS-denied mode", () => {
    const fused = fuseNavHeading({ gpsDenied: true, manual: 180, device: 45, gps: 90 });
    expect(fused).toEqual({ heading: 180, source: "manual" });
  });

  it("labels sources for the HUD", () => {
    expect(headingSourceLabel("compass")).toMatch(/compass/i);
  });

  it("measures angular difference across the 360° wrap", () => {
    expect(headingAngularDifference(350, 10)).toBe(20);
    expect(headingAngularDifference(10, 350)).toBe(20);
  });

  it("warns when compass and GPS diverge beyond threshold", () => {
    const warn = headingDisagreement({ compass: 10, gps: 90 });
    expect(warn.disagrees).toBe(true);
    expect(warn.deltaDeg).toBe(80);
    expect(warn.message).toMatch(/differ by 80°/);
    expect(headingDisagreement({ compass: 10, gps: 30 }).disagrees).toBe(false);
  });
});
