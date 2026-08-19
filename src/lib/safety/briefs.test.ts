import { describe, expect, it } from "vitest";
import { aceReport, fieldMetar, smeacBrief } from "./briefs";

describe("field briefs", () => {
  it("builds a SMEAC with grid and ICE", () => {
    const text = smeacBrief({
      trailName: "Mist Trail",
      lat: 37.7459,
      lng: -119.5936,
      profile: { name: "Pat", iceName: "Sam", icePhone: "5551212", medical: "", partySize: 2 },
    });
    expect(text).toContain("S — SITUATION");
    expect(text).toContain("M — MISSION");
    expect(text).toContain("ICE: Sam");
  });

  it("reports ACE water and casualties", () => {
    const text = aceReport({ waterLiters: 1.5, injured: 1, partySize: 3, lat: 37.1, lng: -119.2 });
    expect(text).toContain("1.5 L");
    expect(text).toContain("1 of 3");
    expect(text).toContain("LOC:");
  });

  it("formats a field observation line", () => {
    const line = fieldMetar({ sky: "BKN", windKph: 25, visKm: 8, precip: "NONE" });
    expect(line).toContain("BKN");
    expect(line).toContain("25KPH");
  });
});
