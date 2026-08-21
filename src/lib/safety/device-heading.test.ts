import { describe, expect, it } from "vitest";
import {
  fuseNavHeading,
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
});
