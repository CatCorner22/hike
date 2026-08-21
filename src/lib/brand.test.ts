import { describe, expect, it } from "vitest";
import { APP_NAME, APP_SENT_FROM, APP_TAGLINE } from "./brand";

describe("brand constants", () => {
  it("uses Klandagi as the product name", () => {
    expect(APP_NAME).toBe("Klandagi");
    expect(APP_TAGLINE).toMatch(/route.*risks.*home/i);
    expect(APP_SENT_FROM).toBe("Sent from Klandagi app");
  });
});
