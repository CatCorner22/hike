import { describe, expect, it } from "vitest";
import { isUsCoverageCoordinate, nearbyCampingBbox } from "./us-coverage";

describe("U.S. camping coverage", () => {
  it.each([
    [37.7, -119.5],
    [64.8, -147.7],
    [21.3, -157.8],
    [18.2, -66.5],
    [13.4, 144.8],
    [-14.3, -170.7],
  ])("accepts supported coordinate %s,%s", (lat, lng) => {
    expect(isUsCoverageCoordinate(lat, lng)).toBe(true);
    expect(nearbyCampingBbox(lat, lng)).not.toBeNull();
  });

  it("rejects coordinates outside declared U.S. coverage", () => {
    expect(isUsCoverageCoordinate(48.85, 2.35)).toBe(false);
    expect(nearbyCampingBbox(48.85, 2.35)).toBeNull();
  });
});
