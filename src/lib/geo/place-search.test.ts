import { describe, expect, it } from "vitest";
import { boundedPlaceBbox } from "./place-search";

describe("place search bounds", () => {
  it("converts and caps a large U.S. administrative bounding box", () => {
    const bbox = boundedPlaceBbox(["32", "42", "-125", "-114"], 37.7, -119.5);
    expect(bbox).toEqual([-120.5, 36.95, -118.5, 38.45]);
  });

  it("refuses a result outside U.S. coverage", () => {
    expect(boundedPlaceBbox(["48", "49", "2", "3"], 48.85, 2.35)).toBeNull();
  });
});
