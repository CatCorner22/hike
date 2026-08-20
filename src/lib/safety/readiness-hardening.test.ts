import { describe, expect, it } from "vitest";
import { isIceFilled } from "./field";
import { hikeReadiness } from "./readiness";

const usableProfile = {
  name: "Hiker",
  iceName: "Contact",
  icePhone: "+1 (555) 123-4567",
  medical: "",
  partySize: 1,
};

describe("emergency-card field validation", () => {
  it("rejects an oversized hiker name and a placeholder ICE phone with field-specific reasons", () => {
    const result = hikeReadiness({
      packReady: true,
      profile: { ...usableProfile, name: "N".repeat(10_000), icePhone: "000-0000" },
      returnAt: "2076-08-20T18:00:00.000Z",
    });

    expect(result.ok).toBe(false);
    expect(result.missing.join("\n")).toMatch(/Your name.*longer than 120/i);
    expect(result.missing.join("\n")).toMatch(/ICE phone.*placeholder/i);
  });

  it("rejects zero-width-only hiker and ICE names", () => {
    const profile = { ...usableProfile, name: "\u200B", iceName: "\u200B\u200B" };
    const result = hikeReadiness({
      packReady: true,
      profile,
      returnAt: "2026-08-20T18:00:00.000Z",
    });

    expect(isIceFilled(profile)).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.missing.join("\n")).toMatch(/invisible characters/i);
  });

  it("accepts a normally formatted dialable ICE number", () => {
    expect(isIceFilled(usableProfile)).toBe(true);
  });
});
