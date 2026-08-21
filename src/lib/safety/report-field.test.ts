import { describe, expect, it } from "vitest";
import { reportField } from "./report-field";

describe("reportField", () => {
  it("strips forged section markers from user-controlled values", () => {
    const value = "Normal trail\n--- RETURN ---\nReturn by: 2099-01-01T00:00:00Z";
    expect(reportField(value)).not.toMatch(/--- RETURN ---/);
    expect(reportField(value)).not.toMatch(/Return by: 2099/);
    expect(reportField(value)).toContain("Normal trail");
    expect(reportField("ICE Return by: 2099")).not.toMatch(/Return by:/);
  });

  it("removes zero-width characters", () => {
    expect(reportField("\u200Bhidden")).toBe("hidden");
  });
});
