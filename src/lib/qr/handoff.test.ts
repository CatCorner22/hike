import { describe, expect, it } from "vitest";
import { encodeQr } from "./encode";
import { buildSarHandoff } from "./handoff";

const PROFILE = {
  name: "Pat Doe",
  iceName: "Sam Doe",
  icePhone: "555-0100",
  medical: "bee-sting allergy, carries epi",
  partySize: 2,
  bloodType: "O+",
  challenge: "what mountain",
  password: "kestrel",
};

describe("SAR handoff payload", () => {
  it("carries the load-bearing facts and always fits in a QR code", () => {
    const text = buildSarHandoff({
      trailName: "Mist Trail",
      lat: 37.7459,
      lng: -119.5936,
      recordedAt: "2026-08-23T10:35:00Z",
      positionSource: "gps",
      returnAtIso: "2026-08-23T22:00:00Z",
      profile: PROFILE,
    });
    expect(text).toContain("SAR HANDOFF");
    expect(text).toContain("Mist Trail");
    expect(text).toContain("37.74590, -119.59360");
    expect(text).toMatch(/live GPS/);
    expect(text).toMatch(/Return by/);
    expect(text).toContain("ICE: Sam Doe 555-0100");
    expect(text).toContain("party of 2");
    expect(encodeQr(text)).not.toBeNull();
  });

  it("states position provenance so a relayed fix never reads as live", () => {
    const dead = buildSarHandoff({ lat: 37, lng: -119, positionSource: "deadReckon" });
    expect(dead).toContain("DEAD RECKON — not live GPS");
    const last = buildSarHandoff({ lat: 37, lng: -119, stale: true });
    expect(last).toContain("LAST KNOWN — GPS not live");
  });

  it("degrades missing data to honest labels instead of dropping silently", () => {
    const text = buildSarHandoff({ lat: Number.NaN, lng: -119, recordedAt: "garbage" });
    expect(text).toContain("Position UNKNOWN — no usable fix");
    const noTime = buildSarHandoff({ lat: 37, lng: -119, recordedAt: "garbage" });
    expect(noTime).toContain("time UNKNOWN");
    const badReturn = buildSarHandoff({ returnAtIso: "not-a-time" });
    expect(badReturn).toContain("Return time invalid");
  });

  it("never leaks the duress challenge or password", () => {
    const text = buildSarHandoff({ profile: PROFILE });
    expect(text).not.toContain("kestrel");
    expect(text).not.toContain("what mountain");
  });
});
