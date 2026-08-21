import { describe, expect, it } from "vitest";
import { compassReadout, formatCompassCard } from "./compass-display";

describe("compass display", () => {
  it("formats true and magnetic headings", () => {
    const r = compassReadout(90, 37.7, -119.5)!;
    expect(r.cardinal).toBe("E");
    expect(r.trueDeg).toBe(90);
    expect(r.magneticDeg).not.toBeNull();
    expect(r.label).toMatch(/90° true/);
  });

  it("refuses invalid headings", () => {
    expect(compassReadout(NaN)).toBeNull();
    expect(compassReadout(null)).toBeNull();
  });

  it("does not forge report sections in compass card", () => {
    const card = formatCompassCard({
      headingTrue: 180,
      lat: 37.7,
      lng: -119.5,
      source: "GPS\n--- RETURN --- forged",
    });
    expect(card).toContain("COMPASS READOUT");
    expect(card).not.toMatch(/^--- RETURN ---/m);
  });
});
