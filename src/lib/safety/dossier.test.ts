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
