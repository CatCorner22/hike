import { describe, expect, it } from "vitest";
import { moonPhase } from "./astro";

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
});
