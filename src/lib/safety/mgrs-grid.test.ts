import { describe, expect, it } from "vitest";
import { adjacentGridSquares, gridSquareBounds, formatMgrsGridCard, gridSquareCorners } from "./mgrs-grid";

describe("MGRS grid squares", () => {
  const lat = 37.7459;
  const lng = -119.5936;

  it("returns 1 km cell bounds", () => {
    const cell = gridSquareBounds(lat, lng, 1000);
    expect(cell).not.toBeNull();
    expect(cell!.grid).toMatch(/^\d{1,2}[C-X] [A-Z]{2} \d{3} \d{3}$/);
    expect(cell!.sw.lat).toBeLessThan(cell!.ne.lat);
    expect(cell!.hundredKmId).toMatch(/^\d{1,2}[C-X] [A-Z]{2}$/);
  });

  it("lists adjacent 1 km squares", () => {
    const adj = adjacentGridSquares(lat, lng, 1000);
    expect(adj.map((a) => a.direction).sort()).toEqual(["E", "N", "S", "W"]);
    expect(adj.every((a) => a.grid.length > 5)).toBe(true);
  });

  it("formats a grid card without injection", () => {
    const card = formatMgrsGridCard(lat, lng);
    expect(card).toContain("MGRS / USNG GRID SQUARE");
    expect(card).toContain("100 km square");
  });

  it("returns four corners of the 100 km square", () => {
    const corners = gridSquareCorners(lat, lng, 100_000);
    expect(corners).toHaveLength(4);
    expect(corners![0].lat).toBeLessThan(corners![2].lat);
  });
});
