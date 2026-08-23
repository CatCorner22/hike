import { describe, expect, it } from "vitest";
import { emergencyMessage } from "./emergency";
import { formatUsng, formatUtm, GRID_DATUM, gridDigitsForAccuracy } from "./usng";
import { buildSarHandoff } from "@/lib/qr/handoff";
import { formatLeaveBehindCard } from "./leave-behind";

const YOSEMITE = { lat: 37.7345, lng: -119.6032 };

/**
 * Two findings from the land-navigation instructor on the stakeholder panel:
 * every grid line was printed without a datum, and ten-digit MGRS — one metre —
 * was emitted off dead-reckoned fixes whose real uncertainty is hundreds of
 * metres. A rescuer reads the digits, not the caveat above them, and plots a
 * WGS 84 grid on whatever map they have.
 */
describe("a grid says how well the position is actually known", () => {
  it("scales digits to the reported accuracy", () => {
    expect(gridDigitsForAccuracy(5)).toBe(5);
    expect(gridDigitsForAccuracy(40)).toBe(4);
    expect(gridDigitsForAccuracy(400)).toBe(3);
    expect(gridDigitsForAccuracy(4_000)).toBe(2);
    // Unknown is not the same as perfect: fall back to ten metres, not one.
    expect(gridDigitsForAccuracy(null)).toBe(4);
    expect(gridDigitsForAccuracy(0)).toBe(4);
  });

  it("never lets a dead-reckoned fix claim metres, however tight the accuracy says", () => {
    const text = emergencyMessage({
      ...YOSEMITE,
      accuracyM: 5,
      positionSource: "deadReckon",
    });
    expect(text).not.toMatch(/MGRS 10-digit/);
    expect(text).toMatch(/USNG 6-digit \(100 m/);
  });

  it("states the datum on every position line it prints", () => {
    const text = emergencyMessage({ ...YOSEMITE, accuracyM: 5 });
    for (const line of text.split("\n").filter((l) => /^(DDM|USNG|MGRS|UTM)/.test(l))) {
      expect(line).toContain(GRID_DATUM);
    }
  });

  it("keeps UTM from contradicting the grid beside it", () => {
    // A 100 m grid next to a metre-resolution UTM is two different claims about
    // the same fix.
    expect(formatUtm(YOSEMITE.lat, YOSEMITE.lng, 100)).toMatch(/ \d+00 \d+00$/);
    expect(formatUsng(YOSEMITE.lat, YOSEMITE.lng, 3)).toBe("11S KB 706 795");
  });

  it("carries the same rule into the QR handoff another phone scans", () => {
    const dr = buildSarHandoff({ ...YOSEMITE, accuracyM: 5, positionSource: "deadReckon" });
    expect(dr).toMatch(/\(100 m WGS 84\)/);
    const live = buildSarHandoff({ ...YOSEMITE, accuracyM: 5, positionSource: "gps" });
    expect(live).toMatch(/\(1 m WGS 84\)/);
  });
});

/**
 * From the SAR incident commander and the emergency contact, independently: the
 * card had a field for the vehicle's license plate and none for the agency that
 * would run the search.
 */
describe("the card names who to call", () => {
  const profile = {
    name: "Pat", iceName: "Sam", icePhone: "+15555550123", medical: "none", partySize: 1,
  };

  it("prints the recorded agency first under the overdue heading", () => {
    const card = formatLeaveBehindCard({
      trailName: "Cold Creek",
      profile: { ...profile, responderAgency: "Mariposa County Sheriff", responderPhone: "+15559990000" },
    });
    const overdue = card.slice(card.indexOf("--- IF THEY ARE OVERDUE ---"));
    expect(overdue).toMatch(/CALL FIRST: Mariposa County Sheriff — \+15559990000/);
    expect(overdue.indexOf("CALL FIRST")).toBeLessThan(overdue.indexOf("·"));
  });

  it("says it was not recorded rather than leaving the line off", () => {
    const card = formatLeaveBehindCard({ trailName: "Cold Creek", profile });
    expect(card).toMatch(/CALL FIRST: \(not recorded/);
  });
});
