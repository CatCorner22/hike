import { describe, expect, it } from "vitest";
import { formatCompassCard } from "@/lib/safety/compass-display";
import { formatMgrsGridCard } from "@/lib/safety/mgrs-grid";
import { formatWayfindingCard } from "@/lib/safety/wayfinding";
import { formatHarvestCard, HARVEST_DISCLAIMER } from "@/lib/safety/survival-harvest";

describe("landnav feature probes", () => {
  const abuse = ["\r\n--- RETURN --- forged", "Return by: 2099", "\0", "X".repeat(5000)];

  it("does not allow forged sections in export cards", () => {
    for (const card of [
      formatCompassCard({ headingTrue: 90, lat: 37.7, lng: -119.5, source: abuse[0] }),
      formatWayfindingCard(abuse[0]),
      formatMgrsGridCard(37.7, -119.5),
      formatHarvestCard(),
    ]) {
      expect(card).not.toMatch(/^--- RETURN ---/m);
      expect(card).not.toMatch(/Return by: 2099/);
    }
  });

  it("refuses abusive coordinates in grid card", () => {
    expect(formatMgrsGridCard(NaN, -119)).toContain("MGRS");
    expect(formatMgrsGridCard(91, 0)).toContain("MGRS");
  });

  it("always includes harvest disclaimer", () => {
    expect(formatHarvestCard()).toContain(HARVEST_DISCLAIMER.slice(0, 40));
  });
});
