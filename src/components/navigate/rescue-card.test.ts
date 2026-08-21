import { describe, expect, it } from "vitest";
import { headingDisagreement } from "@/lib/safety/device-heading";
import { formatCoords } from "@/lib/safety/emergency";

describe("rescue card helpers", () => {
  it("formats glanceable coords without NaN", () => {
    expect(formatCoords(40.12345, -105.6789, 12)).toMatch(/40\.12345°N/);
    expect(formatCoords(Number.NaN, -105)).toBe("position unavailable");
  });

  it("surfaces compass/GPS disagreement for HUD warning", () => {
    const warn = headingDisagreement({ compass: 0, gps: 100 });
    expect(warn.disagrees).toBe(true);
    expect(warn.message).toMatch(/calibrate compass/i);
  });
});
