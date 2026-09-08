import { describe, expect, it } from "vitest";
import { formatLeaveBehindCard, LEAVE_BEHIND_DISCLAIMER } from "./leave-behind";
import { REPORT_MAX_LENGTH } from "./report-field";

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
      vehicle: "Truck\n--- RETURN ---\nAgreed overdue-action time: forged",
      notes: "Clockwise\n--- PARTY ---\nICE: forged",
      routeFacts: [{ label: "Distance\n--- RETURN ---", value: "forged" }],
      waypoints: [{ name: "Spring\n--- RETURN ---\nforged", kind: "water" }],
      bailouts: [{ name: "Road\n--- RETURN ---\nforged" }],
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

  it("prints only supplied schedule, vehicle, route facts, waypoints, and bailout candidates", () => {
    const card = formatLeaveBehindCard({
      trailName: "Pine Ridge",
      profile,
      plannedDate: "2026-08-22T12:00:00.000Z",
      departureTime: "07:30",
      returnAt: "2026-08-23T01:00:00.000Z",
      vehicle: "Blue Subaru, plate ABC 123",
      notes: "Clockwise from the north lot",
      routeFacts: [{
        label: "Saved route distance",
        value: "8.4 mi",
        basis: "calculated from the saved route line",
      }],
      waypoints: [{
        name: "Lunch creek",
        kind: "Marked water",
        lat: 37.75,
        lng: -119.5,
      }],
      bailouts: [{
        name: "East road",
        kind: "Bailout candidate",
        routePosition: "5.1 mi into saved route",
        detail: "Nearby mapped feature; not a confirmed exit.",
      }],
    });

    expect(card).toContain("Planned date: Saturday, Aug 22, 2026");
    expect(card).toContain("Planned departure: 7:30 AM (time entered on this device)");
    // Corrected expectation: this line used to be `deadline.toISOString()`, and
    // for an evening return that carries TOMORROW's date under a "Planned date"
    // line rendered as a local wall clock. It is the one fact that starts a
    // search, so it now leads with the hiker's own clock when one was stored
    // and otherwise says plainly that the time is UTC.
    expect(card).toContain("Call for help if not heard from by:");
    expect(card).toContain("0100Z 23 AUG 2026");
    expect(card).not.toContain("2026-08-23T01:00:00.000Z");
    expect(card).toContain("Vehicle: Blue Subaru, plate ABC 123");
    expect(card).toContain("Notes: Clockwise from the north lot");
    expect(card).toContain("--- ROUTE FACTS ---");
    expect(card).toContain("Saved route distance: 8.4 mi (calculated from the saved route line)");
    expect(card).toContain("--- NAMED WAYPOINTS ---");
    expect(card).toMatch(/Lunch creek .*Marked water/);
    expect(card).toContain("--- BAILOUT CANDIDATES / VERIFY BEFORE TRIP ---");
    expect(card).toMatch(/East road .*not a confirmed exit/);
    expect(card).toMatch(/does not prove a usable exit/i);
  });

  it("labels missing planning fields instead of guessing them", () => {
    const card = formatLeaveBehindCard({
      trailName: "Unscheduled route",
      profile,
      plannedDate: "not-a-date",
      departureTime: "26:99",
    });

    expect(card).toContain("Planned date: (not set)");
    expect(card).toContain("Planned departure: (not set)");
    expect(card).toContain("Vehicle: (not set)");
    expect(card).not.toContain("--- NAMED WAYPOINTS ---");
    expect(card).not.toContain("--- BAILOUT CANDIDATES");
  });

  it("keeps deadline and overdue instructions while explicitly omitting oversized lists", () => {
    const long = "x".repeat(400);
    const card = formatLeaveBehindCard({
      trailName: `Long route ${long}`,
      profile: {
        ...profile,
        name: long,
        medical: long,
      },
      returnAt: "2026-08-23T01:00:00.000Z",
      routeFacts: Array.from({ length: 100 }, (_, index) => ({
        label: `Fact ${index} ${long}`,
        value: long,
        basis: long,
      })),
      waypoints: Array.from({ length: 100 }, (_, index) => ({
        name: `Waypoint ${index} ${long}`,
        detail: long,
      })),
      bailouts: Array.from({ length: 100 }, (_, index) => ({
        name: `Exit ${index} ${long}`,
        detail: long,
      })),
    });

    expect(card.length).toBeLessThanOrEqual(REPORT_MAX_LENGTH);
    expect(card.endsWith(" …[TRUNCATED]")).toBe(false);
    expect(card).toContain("--- RETURN ---");
    // Corrected expectation: this line used to be `deadline.toISOString()`, and
    // for an evening return that carries TOMORROW's date under a "Planned date"
    // line rendered as a local wall clock. It is the one fact that starts a
    // search, so it now leads with the hiker's own clock when one was stored
    // and otherwise says plainly that the time is UTC.
    expect(card).toContain("Call for help if not heard from by:");
    expect(card).toContain("0100Z 23 AUG 2026");
    expect(card).not.toContain("2026-08-23T01:00:00.000Z");
    expect(card).toContain(LEAVE_BEHIND_DISCLAIMER);
    expect(card).toContain("--- IF THEY ARE OVERDUE ---");
    expect(card).toContain("Give SAR the exact itinerary");
    expect(card).toMatch(/more route facts? omitted/);
    expect(card).toMatch(/more named waypoints? omitted/);
    expect(card).toMatch(/more bailout candidates? omitted/);
  });
});
