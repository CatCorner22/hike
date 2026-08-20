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
