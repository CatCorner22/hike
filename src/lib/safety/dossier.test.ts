import { describe, expect, it } from "vitest";
import { buildSafetyDossier } from "./dossier";

describe("buildSafetyDossier", () => {
  it("includes ICE, position, and emergency block", () => {
    const text = buildSafetyDossier({
      profile: {
        name: "Alex",
        iceName: "Sam",
        icePhone: "555-0100",
        medical: "none",
        partySize: 2,
        bloodType: "O+",
      },
      trailName: "Half Dome",
      packId: "plan-1",
      lat: 37.7,
      lng: -119.5,
      checkins: [],
    });
    expect(text).toMatch(/Alex/);
    expect(text).toMatch(/Sam/);
    expect(text).toMatch(/Half Dome/);
    expect(text).toMatch(/SOS \/ EMERGENCY LOCATION/);
    expect(text).toMatch(/USNG/);
  });
});

describe("dossier grid fallback", () => {
  /**
   * formatUsng returns null off the UTM band (above 84 N, below 80 S) and for a
   * non-finite position. Interpolated raw, the sheet handed to searchers read
   * "USNG: null" — worse than saying nothing, because it looks like data.
   */
  it("says the grid is unavailable instead of printing the word null", () => {
    for (const [lat, lng] of [
      [86.2, -60],
      [-82.5, 20],
      [Number.NaN, -119.6],
    ] as const) {
      const sheet = buildSafetyDossier({
        profile: { name: "A", partySize: 2 } as never,
        trailName: "Route",
        packId: "p1",
        lat,
        lng,
      });
      expect(sheet, `${lat}`).not.toMatch(/null/);
      expect(sheet).toMatch(/USNG\/MGRS: unavailable/);
    }
  });

  it("still prints a real grid inside the UTM band", () => {
    const sheet = buildSafetyDossier({
      profile: { name: "A", partySize: 2 } as never,
      trailName: "Route",
      packId: "p1",
      lat: 37.7,
      lng: -119.6,
    });
    expect(sheet).toMatch(/USNG: 11S/);
    expect(sheet).not.toMatch(/unavailable/);
  });
});
