import { describe, expect, it } from "vitest";
import { verifyRegroup } from "./verify";

describe("verifyRegroup", () => {
  it("passes when challenge and password match", () => {
    const r = verifyRegroup({
      challengeResponse: "Eagle",
      passwordResponse: "Blue",
      expectedChallenge: "eagle",
      expectedPassword: "blue",
    });
    expect(r.ok).toBe(true);
  });

  it("fails on wrong password", () => {
    const r = verifyRegroup({
      challengeResponse: "Eagle",
      passwordResponse: "Red",
      expectedChallenge: "Eagle",
      expectedPassword: "Blue",
    });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Password/);
  });

  it("requires ICE fields to be set", () => {
    const r = verifyRegroup({
      challengeResponse: "x",
      passwordResponse: "y",
    });
    expect(r.ok).toBe(false);
  });
});
