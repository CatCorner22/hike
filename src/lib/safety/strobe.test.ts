import { describe, expect, it } from "vitest";
import { smsHref } from "./strobe";

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
