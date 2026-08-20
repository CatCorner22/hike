import { describe, expect, it } from "vitest";
import { formatUsng, formatUtm, utmZone } from "./usng";

describe("USNG / UTM", () => {
  it("places Yosemite in UTM zone 11", () => {
    expect(utmZone(37.7459, -119.5936)).toBe(11);
    expect(formatUtm(37.7459, -119.5936)).toMatch(/^11N /);
  });

  it("places San Francisco in UTM zone 10", () => {
    expect(utmZone(37.7749, -122.4194)).toBe(10);
  });

  it("formats an 8-digit USNG grid for SAR", () => {
    const usng = formatUsng(37.7459, -119.5936)!;
    expect(usng).toMatch(/^\d{2}[C-HJ-NP-X] [A-Z]{2} \d{4} \d{4}$/);
  });
});
