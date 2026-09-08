import { describe, expect, it } from "vitest";
import { buildRouteDifficultySnapshot } from "./difficulty-intelligence";

describe("route difficulty intelligence", () => {
  it("explains measured effort without creating an overall rating", () => {
    const result = buildRouteDifficultySnapshot({
      geometryDistanceMeters: 1_500,
      elevationProfile: [
        { distanceMeters: 0, elevation: 100 },
        { distanceMeters: 500, elevation: 150 },
        { distanceMeters: 1_000, elevation: 100 },
        { distanceMeters: 1_500, elevation: 200 },
      ],
    });

    expect(result.factors.find((factor) => factor.id === "distance")).toMatchObject({
      state: "measured",
      value: "0.93 mi",
    });
    expect(result.factors.find((factor) => factor.id === "elevation")?.value).toBe(
      "+492 ft / −164 ft",
    );
    expect(result.factors.find((factor) => factor.id === "grade")?.value).toBe(
      "max 20.0% · sustained 20.0%",
    );
    expect(result).not.toHaveProperty("rating");
    expect(result).not.toHaveProperty("score");
  });

  it("keeps absent terrain evidence explicitly unknown", () => {
    const result = buildRouteDifficultySnapshot({ geometryDistanceMeters: 5_000 });

    for (const id of ["elevation", "grade", "altitude", "technical", "crossings", "exposure", "shade", "water"]) {
      expect(result.factors.find((factor) => factor.id === id)?.state, id).toBe("unknown");
    }
    expect(result.factors.find((factor) => factor.id === "water")?.detail).toMatch(/Do not assume/i);
  });

  it("separates community-reported tags from measurements", () => {
    const result = buildRouteDifficultySnapshot({
      tags: {
        sac_scale: "demanding_mountain_hiking",
        surface: "rock",
        trail_visibility: "bad",
        drinking_water: "yes",
      },
    });

    expect(result.factors.find((factor) => factor.id === "technical")).toMatchObject({
      state: "reported",
      source: "OpenStreetMap route metadata",
    });
    expect(result.factors.find((factor) => factor.id === "route-finding")?.value).toBe("bad");
    expect(result.factors.find((factor) => factor.id === "water")?.state).toBe("reported");
  });

  it("ignores invalid elevation samples instead of leaking NaN or Infinity", () => {
    const result = buildRouteDifficultySnapshot({
      elevationProfile: [
        { distanceMeters: 0, elevation: 100 },
        { distanceMeters: 200, elevation: Number.NaN },
        { distanceMeters: 500, elevation: 150 },
        { distanceMeters: Number.POSITIVE_INFINITY, elevation: 300 },
      ],
    });
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain("NaN");
    expect(serialized).not.toContain("Infinity");
    expect(result.factors.find((factor) => factor.id === "elevation")?.state).toBe("measured");
  });

  it("surfaces a material route-length disagreement", () => {
    const distance = buildRouteDifficultySnapshot({
      geometryDistanceMeters: 10_000,
      reportedDistanceMeters: 14_000,
    }).factors.find((factor) => factor.id === "distance");

    expect(distance?.detail).toMatch(/reports 8.70 mi/i);
    expect(distance?.detail).toMatch(/Investigate/);
  });
});
