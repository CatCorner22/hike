import { describe, expect, it } from "vitest";
import { emergencyMessage, formatCoords } from "./emergency";

describe("emergency helpers", () => {
  it("formats coordinates with hemisphere labels", () => {
    expect(formatCoords(37.12345, -119.54321, 12)).toContain("N");
    expect(formatCoords(37.12345, -119.54321, 12)).toContain("W");
  });

  it("builds a shareable emergency message", () => {
    const msg = emergencyMessage({
      lat: 37.1,
      lng: -119.2,
      accuracyM: 8,
      trailName: "Test Trail",
      offTrailM: 55,
    });
    expect(msg).toContain("SOS / EMERGENCY LOCATION");
    expect(msg).toContain("Test Trail");
    expect(msg).toContain("maps.google.com");
    expect(msg).toContain("USNG 8-digit");
    expect(msg).toContain("MGRS 10-digit");
    expect(msg).not.toContain("USNG 8°");
    expect(msg).not.toContain("MGRS 10°");
    expect(msg).toContain("UTM:");
  });

  it("includes blood type when the ICE card has it", () => {
    const msg = emergencyMessage({
      lat: 37.1,
      lng: -119.2,
      profile: {
        name: "Pat",
        iceName: "",
        icePhone: "",
        medical: "",
        partySize: 1,
        bloodType: "O+",
      },
    });
    expect(msg).toContain("Blood type: O+");
  });

  it("labels stale last-known coordinates so rescuers are not misled", () => {
    const msg = emergencyMessage({
      lat: 37.1,
      lng: -119.2,
      stale: true,
      recordedAt: Date.parse("2026-08-19T18:00:00Z"),
    });
    expect(msg).toContain("LAST KNOWN POSITION");
    expect(msg).toContain("2026-08-19T18:00:00.000Z");
  });

  it("still produces a message when GPS has never arrived", () => {
    const msg = emergencyMessage({ trailName: "Half Dome" });
    expect(msg).toContain("No GPS fix");
    expect(msg).toContain("Half Dome");
  });

  it("does not treat NaN as a live fix", () => {
    const msg = emergencyMessage({ lat: Number.NaN, lng: Number.NaN });
    expect(msg).toContain("No GPS fix");
    expect(msg).not.toContain("NaN");
  });
});
