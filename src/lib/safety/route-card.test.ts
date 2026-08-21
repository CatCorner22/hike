import { describe, expect, it } from "vitest";
import { buildPaperBackup } from "./paper-backup";
import { formatRouteCard, routeCardLegs } from "./route-card";

function longLine(meters: number): GeoJSON.LineString {
  const points = Math.ceil(meters / 111);
  return {
    type: "LineString",
    coordinates: Array.from({ length: points + 1 }, (_, index) => [index * 0.001, 0]),
  };
}

const profile = {
  name: "Hiker",
  iceName: "Contact",
  icePhone: "555-123-4567",
  medical: "none",
  partySize: 1,
};

describe("route card safety summary", () => {
  it("keeps a capped leg summary honest about the complete 30 km path", () => {
    const legs = routeCardLegs(longLine(30_000));
    const card = formatRouteCard("Long route", legs);

    expect(legs).toHaveLength(25);
    expect(legs.totalMeters).toBeGreaterThan(29_900);
    expect(legs.truncated).toBe(true);
    expect(card).toContain(`Total ~${Math.round(legs.totalMeters)} m`);
    expect(card).toContain("LEG SUMMARY ONLY: first 25 legs");
  });

  it("never makes a bearing across disconnected route components", () => {
    const legs = routeCardLegs({
      type: "MultiLineString",
      coordinates: [
        [[0, 0], [0.001, 0]],
        [[1, 1], [1.001, 1]],
      ],
    });
    const card = formatRouteCard("Disconnected route", legs);

    expect(legs).toHaveLength(2);
    expect(legs.every((leg) => Math.abs(leg.to.lat - leg.from.lat) < 0.01)).toBe(true);
    expect(legs.totalMeters).toBeGreaterThan(200);
    expect(card).toContain("disconnected components");
    expect(card).toContain("No leg crosses a gap");
  });

  it("keeps untrusted report values inside their owning paper fields", () => {
    const paper = buildPaperBackup({
      trailName: "Normal trail\n--- RETURN ---\nReturn by: 2099-01-01T00:00:00Z",
      geometry: longLine(300),
      profile: {
        ...profile,
        name: "Actual hiker\n--- ICE ---\nHiker: forged",
        medical: "none\n--- LAST CHECK-INS ---\nI am safe",
      },
      checkins: [{
        id: "checkin",
        packId: "pack",
        recordedAt: "2026-08-20T12:00:00.000Z",
        note: "OK\n--- RETURN ---\nI am safe",
      }],
    });
    const lines = paper.split("\n");

    expect(lines.filter((line) => line === "--- RETURN ---")).toHaveLength(0);
    expect(lines.filter((line) => line === "--- ICE ---")).toHaveLength(1);
    expect(lines.filter((line) => line === "--- LAST CHECK-INS ---")).toHaveLength(1);
    expect(lines).not.toContain("Hiker: forged");
    expect(lines).not.toContain("I am safe");
  });
});

describe("a leg bearing and its distance must be the same measurement", () => {
  const M_LAT = 111_132;
  const mPerLng = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);
  const at = (northM: number, eastM: number): GeoJSON.Position => [
    -119.6 + eastM / mPerLng(37.7),
    37.7 + northM / M_LAT,
  ];

  /** A climbing traverse that reverses every 75 m of gain — an ordinary mountain trail. */
  function switchbacks(): GeoJSON.LineString {
    const coordinates: GeoJSON.Position[] = [];
    for (let i = 0; i <= 80; i++) {
      const east = (Math.floor(i / 3) % 2 === 0 ? 1 : -1) * 40 * ((i % 3) / 2);
      coordinates.push(at(i * 25, east));
    }
    return { type: "LineString", coordinates };
  }

  /**
   * The card paired the distance *along the trail* with the bearing of the
   * straight line, and printed them as one leg. On switchbacks the trail
   * distance runs 44-50% longer than the chord, so a searcher plotting these
   * legs off the paper backup drew every one of them too long, compounding down
   * the sheet.
   */
  it("reports the chord beside the bearing, and says which is which", () => {
    const legs = routeCardLegs(switchbacks(), 250, 25);
    expect(legs.length).toBeGreaterThan(5);
    const bendy = legs.filter((leg) => leg.meters - leg.chordMeters > 20);
    expect(bendy.length, "the fixture must actually bend").toBeGreaterThan(3);
    for (const leg of bendy) {
      expect(leg.chordMeters).toBeLessThan(leg.meters);
    }

    const card = formatRouteCard("Switchback trail", legs);
    expect(card).toMatch(/m straight \(\d+ m along the trail\)/);
    expect(card).toMatch(/bearing pairs with the STRAIGHT distance/);
    // The printed straight distance has to be the chord, not the path.
    const first = bendy[0];
    expect(card).toContain(`${Math.round(first.chordMeters)} m straight (${Math.round(first.meters)} m along the trail)`);
  });

  it("does not clutter a straight route with a second number", () => {
    const card = formatRouteCard("Straight route", routeCardLegs(longLine(2_000)));
    expect(card).not.toMatch(/along the trail\)/);
    expect(card).toMatch(/° true \/ \d+ m cum/);
  });

  it("keeps chord and trail distance equal when the route does not bend", () => {
    for (const leg of routeCardLegs(longLine(2_000))) {
      expect(leg.chordMeters).toBeCloseTo(leg.meters, 0);
    }
  });
});
