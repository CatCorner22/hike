import { describe, expect, it } from "vitest";
import { downsampleActivityPoints } from "./display-points";

describe("downsampleActivityPoints", () => {
  it("keeps endpoints and reports the authoritative point count", () => {
    const points = Array.from({ length: 2_005 }, (_, index) => ({ index }));
    const display = downsampleActivityPoints(points);

    expect(display.downsampled).toBe(true);
    expect(display.pointCount).toBe(2_005);
    expect(display.points.length).toBeLessThanOrEqual(2_000);
    expect(display.points[0]).toBe(points[0]);
    expect(display.points.at(-1)).toBe(points.at(-1));
  });

  it("does not copy or label an already bounded track as reduced", () => {
    const points = [{ index: 0 }, { index: 1 }];
    expect(downsampleActivityPoints(points)).toEqual({
      points,
      pointCount: 2,
      downsampled: false,
    });
  });
});
