import { describe, expect, it } from "vitest";
import { imsafeWarning, mistReport, sitrep } from "./reports";

describe("sitrep / mist", () => {
  it("builds a SITREP with grid and DTG", () => {
    const text = sitrep({
      lat: 37.7459,
      lng: -119.5936,
      trailName: "Mist Trail",
      profile: { name: "Pat", iceName: "", icePhone: "", medical: "", partySize: 2, bloodType: "O+" },
      status: "lost — staying put",
    });
    expect(text).toContain("SITREP");
    expect(text).toContain("LOC:");
    expect(text).toContain("BLOOD: O+");
    expect(text).toContain("Mist Trail");
  });

  it("builds a MIST handoff", () => {
    const text = mistReport({
      mechanism: "fall on talus",
      injuries: "ankle",
      lat: 37.1,
      lng: -119.2,
    });
    expect(text).toContain("M — Mechanism");
    expect(text).toContain("LOC:");
  });

  it("flags IMSAFE items", () => {
    expect(imsafeWarning([])).toBeNull();
    expect(imsafeWarning(["fatigue", "illness"])).toMatch(/fatigue/);
  });
});

describe("SITREP grid fallback", () => {
  /** A null grid used to be read over the radio as "null (LAST KNOWN)". */
  it("falls back to lat/long rather than the word null", () => {
    const out = sitrep({ lat: 86.2, lng: -60, stale: true });
    expect(out).not.toMatch(/null/);
    expect(out).toMatch(/NO GRID — LAT\/LONG 86\.20000 -60\.00000 \(LAST KNOWN\)/);
  });

  it("keeps the grid when there is one", () => {
    expect(sitrep({ lat: 37.7, lng: -119.6 })).toMatch(/11S/);
  });
});
