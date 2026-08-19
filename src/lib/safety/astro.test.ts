import { describe, expect, it } from "vitest";
import { moonPhase, shadowStickHeading, sunPosition } from "./astro";

describe("moonPhase", () => {
  it("calls a new moon nearly dark", () => {
    const phase = moonPhase(new Date(Date.UTC(2000, 0, 6, 18, 14)));
    expect(phase.illumination).toBeLessThan(0.05);
    expect(phase.name).toMatch(/New/);
  });

  it("calls ~15 days later a full moon", () => {
    const phase = moonPhase(new Date(Date.UTC(2000, 0, 21, 18, 14)));
    expect(phase.illumination).toBeGreaterThan(0.9);
    expect(phase.name).toMatch(/Full/);
  });

  it("puts the noon sun in the southern sky in California", () => {
    const pos = sunPosition(new Date(Date.UTC(2026, 5, 21, 20, 0)), 37.7, -119.6);
    expect(pos).not.toBeNull();
    expect(pos!.elevation).toBeGreaterThan(20);
    expect(pos!.azimuth).toBeGreaterThan(90);
    expect(pos!.azimuth).toBeLessThan(270);
  });

  it("points the shadow opposite the sun", () => {
    expect(shadowStickHeading(180).shadowToward).toBe(0);
  });
});
