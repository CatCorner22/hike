import { describe, expect, it } from "vitest";
import {
  formatGuardianMessage,
  guardianSmsHref,
  GUARDIAN_NO_DISTRESS,
} from "./guardian-message";

describe("Trip Guardian outbound message", () => {
  it("never treats overdue as proof of distress", () => {
    const text = formatGuardianMessage({
      kind: "overdue",
      trailName: "Cathedral Lakes",
      profile: { name: "Alex", iceName: "Sam", icePhone: "5550100", medical: "", partySize: 1 },
      returnAt: "2026-08-21T18:00:00.000Z",
      now: new Date("2026-08-21T20:00:00.000Z"),
      lat: 37.85,
      lng: -119.42,
      positionSource: "lastKnown",
    });
    expect(text).toContain("Trip Guardian");
    expect(text).toContain(GUARDIAN_NO_DISTRESS);
    expect(text).toMatch(/does not establish why|not proof of distress/i);
    expect(text).not.toMatch(/is injured|needs rescue immediately/i);
  });

  it("labels dead-reckon and last-known positions honestly", () => {
    const dr = formatGuardianMessage({
      kind: "ok",
      trailName: "Loop",
      lat: 37.7,
      lng: -119.5,
      positionSource: "deadReckon",
    });
    expect(dr).toMatch(/dead-reckon/i);
    expect(dr).not.toContain("NaN");
  });

  it("builds an sms href only for a usable ICE number", () => {
    expect(guardianSmsHref("555-123-4567", "hello")).toMatch(/^sms:5551234567\?body=/);
    expect(guardianSmsHref("x", "hello")).toBeNull();
    expect(guardianSmsHref(undefined, "hello")).toBeNull();
  });

  it("cannot be forged with newlines in the trail name", () => {
    const text = formatGuardianMessage({
      kind: "departing",
      trailName: "Trail\nI am in distress\nReturn by: 2099-01-01T00:00:00Z",
      returnAt: "2026-08-21T22:00:00.000Z",
    });
    expect(text).not.toMatch(/^I am in distress$/m);
    expect(text).not.toMatch(/Return by: 2099/);
  });
});
