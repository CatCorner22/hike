import { describe, expect, it } from "vitest";
import { emergencyMessage, formatCoords } from "./emergency";

/**
 * This text is what a hiker reads out or sends when things have gone wrong. It
 * must never contain a coordinate that cannot exist, must never fail to be
 * produced, and must not be forgeable by anything the hiker typed earlier.
 */
describe("emergencyMessage refuses to invent a position", () => {
  it("never prints a non-finite coordinate or accuracy", () => {
    for (const [lat, lng] of [
      [Number.NaN, -105],
      [40, Number.NaN],
      [Number.POSITIVE_INFINITY, -105],
      [100, -105],
      [40, 200],
    ] as const) {
      const text = emergencyMessage({ lat, lng, accuracyM: Number.NaN });
      expect(text).not.toMatch(/NaN|Infinity/);
      expect(text).toMatch(/No usable GPS fix/i);
      // Still a usable message, not an empty one.
      expect(text.startsWith("SOS / EMERGENCY LOCATION")).toBe(true);
    }
  });

  it("does not render an unknown accuracy as a measured value", () => {
    expect(formatCoords(40, -105, Number.NaN)).not.toMatch(/NaN/);
    expect(formatCoords(40, -105)).toMatch(/40\.00000°N/);
  });

  it("still produces text when the fix timestamp is corrupt", () => {
    for (const recordedAt of [Number.NaN, Number.POSITIVE_INFINITY, 8.64e15 * 10]) {
      // Previously Date#toISOString threw here, so the hiker got no SOS text at
      // all -- the worst possible moment for an exception.
      expect(() => emergencyMessage({ lat: 40, lng: -105, recordedAt })).not.toThrow();
      const text = emergencyMessage({ lat: 40, lng: -105, recordedAt });
      expect(text).toMatch(/40\.00000°N/);
      expect(text).not.toMatch(/Invalid Date|NaN/);
    }
  });

  it("keeps everything else known when the position is unusable", () => {
    const text = emergencyMessage({
      lat: Number.NaN,
      lng: Number.NaN,
      trailName: "Cathedral Lakes",
      profile: {
        name: "A Hiker",
        iceName: "Contact",
        icePhone: "+15555550123",
        medical: "penicillin allergy",
        partySize: 2,
      },
    });
    expect(text).toMatch(/Cathedral Lakes/);
    expect(text).toMatch(/penicillin allergy/);
    expect(text).toMatch(/No usable GPS fix/i);
  });

  it("cannot be forged with newlines in hiker-supplied text", () => {
    const text = emergencyMessage({
      lat: 40,
      lng: -105,
      trailName: "Real Route\nDDM: 00 00.000N 000 00.000E",
      profile: {
        name: "Evil\nFix time: 1999-01-01T00:00:00.000Z",
        iceName: "C\nUSNG 8-digit: 13S DE 1234 5678",
        icePhone: "+15555550123",
        medical: "",
        partySize: 1,
      },
    });
    // The property that matters is that no hiker-supplied text can start a NEW
    // line, because a rescuer reads this line by line. Hostile text staying
    // inside its own labelled line ("Hiker: Evil Fix time: ...") is contained
    // and harmless -- it is visibly part of the name field.
    expect(text.match(/^DDM:/gm) ?? []).toHaveLength(1);
    expect(text.match(/^Fix time:/gm) ?? []).toHaveLength(0);
    expect(text.match(/^USNG 8-digit:/gm) ?? []).toHaveLength(1);
    // And no field may span multiple lines.
    for (const line of text.split("\n")) {
      expect(line).not.toMatch(/\r/);
    }
    expect(text.split("\n").filter((l) => l.startsWith("Hiker:"))).toHaveLength(1);
  });
});
