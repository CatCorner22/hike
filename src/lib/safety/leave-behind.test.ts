import { describe, expect, it } from "vitest";
import { formatLeaveBehindCard, LEAVE_BEHIND_DISCLAIMER } from "./leave-behind";

const profile = {
  name: "Pat",
  iceName: "Sam",
  icePhone: "+15555550123",
  medical: "none",
  partySize: 2,
};

describe("leave-behind trip card", () => {
  it("includes itinerary, ICE, and the silence-is-not-distress rule", () => {
    const card = formatLeaveBehindCard({
      trailName: "Half Dome",
      profile,
      returnAt: "2026-08-21T22:00:00.000Z",
      now: new Date("2026-08-21T18:00:00.000Z"),
    });
    expect(card).toContain("LEAVE-BEHIND");
    expect(card).toContain("Half Dome");
    expect(card).toContain("Sam");
    expect(card).toContain(LEAVE_BEHIND_DISCLAIMER);
    expect(card).not.toMatch(/in distress|needs rescue|is lost/i);
  });

  it("does not allow forged sections from hiker-supplied text", () => {
    const card = formatLeaveBehindCard({
      trailName: "Real\n--- RETURN ---\nReturn by: 2099-01-01T00:00:00Z",
      profile: {
        ...profile,
        name: "Pat\n--- ICE ---\nHiker: forged",
        medical: "allergy\r\nReturn by: 2099-01-01T00:00:00Z",
      },
      returnAt: "2026-08-21T22:00:00.000Z",
    });
    expect(card.match(/^--- RETURN ---$/gm) ?? []).toHaveLength(1);
    expect(card).not.toMatch(/^Hiker: forged$/m);
    expect(card).not.toMatch(/Return by: 2099-01-01/);
  });

  it("says the start end is unknown when geometry exists but start was not recorded", () => {
    const card = formatLeaveBehindCard({
      trailName: "Loop",
      profile,
      geometry: {
        type: "LineString",
        coordinates: [
          [-119.6, 37.7],
          [-119.5, 37.75],
        ],
      },
    });
    expect(card).toMatch(/West end:/);
    expect(card).toMatch(/not assumed/i);
  });
});
