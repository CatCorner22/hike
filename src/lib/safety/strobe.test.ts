import { describe, expect, it } from "vitest";
import { smsHref, SOS_VIBRATION_PATTERN } from "./strobe";

describe("smsHref", () => {
  it("uses ?body= when there is no destination on any platform", () => {
    expect(smsHref("", "HELP", "iPhone")).toBe("sms:?body=HELP");
    expect(smsHref(undefined, "HELP", "Android")).toBe("sms:?body=HELP");
    expect(smsHref("abc", "HELP", "iPhone")).toBe("sms:?body=HELP");
  });

  it("uses Apple &body= only when a number is present on iOS", () => {
    expect(smsHref("+15551212", "grid", "iPhone OS")).toBe("sms:+15551212&body=grid");
  });

  it("uses ?body= with a number on Android", () => {
    expect(smsHref("555-1212", "grid", "Android")).toBe("sms:5551212?body=grid");
  });
});

describe("SOS haptic timing", () => {
  // Regression: the pattern used a 320 ms dash against a 120 ms dot and a flat 80 ms gap
  // with no character spacing — rhythmic, but not decodable as Morse.
  it("uses standard Morse ratios", () => {
    const pattern = SOS_VIBRATION_PATTERN;

    const buzzes = pattern.filter((_, index) => index % 2 === 0);
    const gaps = pattern.filter((_, index) => index % 2 === 1);
    const dot = Math.min(...buzzes);
    const dash = Math.max(...buzzes);

    expect(buzzes).toHaveLength(9);
    expect(dash / dot).toBe(3);
    expect(buzzes.slice(0, 3).every((b) => b === dot)).toBe(true);
    expect(buzzes.slice(3, 6).every((b) => b === dash)).toBe(true);
    expect(buzzes.slice(6, 9).every((b) => b === dot)).toBe(true);
    // Six gaps between elements plus two longer gaps between the three characters.
    expect(gaps.filter((g) => g === dot)).toHaveLength(6);
    expect(gaps.filter((g) => g === dot * 3)).toHaveLength(2);
  });
});
