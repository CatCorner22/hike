import { describe, expect, it } from "vitest";
import { formatDeadlineForPerson } from "./deadline-text";
import { formatGuardianMessage } from "./guardian-message";
import { formatLeaveBehindCard } from "./leave-behind";

/**
 * The one line that tells a spouse when to start calling used to be
 * `deadline.toISOString()`. Every US evening return after about 1600 PDT crosses
 * UTC midnight, so it carried TOMORROW's date — printed two lines under a
 * "Planned date: Sunday, Aug 23" that was rendered as a local wall clock. Two
 * time frames stacked with neither labeled, and the wrong one starts a search.
 */
describe("a deadline written for a person who is not the hiker", () => {
  const instant = new Date("2026-08-24T02:00:00.000Z"); // 7pm PDT on Aug 23
  const local = { resolvedLocal: "2026-08-23 19:00", timeZone: "America/Los_Angeles", utcOffset: "GMT-7" };

  it("leads with the hiker's own clock and keeps Zulu for the rescuer", () => {
    const text = formatDeadlineForPerson(instant, local)!;
    expect(text).toContain("2026-08-23 19:00");
    expect(text).toContain("GMT-7");
    expect(text).toContain("America/Los_Angeles");
    expect(text).toContain("0200Z 24 AUG 2026");
    // The local date comes first, so the reader never sees tomorrow's date alone.
    expect(text.indexOf("2026-08-23")).toBeLessThan(text.indexOf("0200Z"));
  });

  it("says a bare instant is UTC rather than guessing the reader's zone", () => {
    const text = formatDeadlineForPerson(instant)!;
    expect(text).toContain("UTC");
    expect(text).toContain("0200Z 24 AUG 2026");
  });

  it("refuses an unusable instant", () => {
    expect(formatDeadlineForPerson(null)).toBeNull();
    expect(formatDeadlineForPerson(new Date("nope"))).toBeNull();
  });

  it("keeps a raw ISO instant out of the leave-behind card and the guardian text", () => {
    const card = formatLeaveBehindCard({
      trailName: "Cold Creek",
      profile: { name: "A", iceName: "B", icePhone: "555-0100", medical: "", partySize: 1, bloodType: "" },
      returnAt: instant.toISOString(),
      returnLocal: local,
      plannedDate: "2026-08-23",
      departureTime: "07:00",
      now: new Date("2026-08-23T14:00:00.000Z"),
    });
    expect(card).not.toContain("2026-08-24T02:00:00.000Z");
    expect(card).toContain("2026-08-23 19:00");
    // A printed card must not carry a countdown that reads as current.
    expect(card).toContain("as of printing");

    const sms = formatGuardianMessage({
      kind: "departing",
      trailName: "Cold Creek",
      returnAt: instant.toISOString(),
      returnLocal: local,
      now: new Date("2026-08-23T14:00:00.000Z"),
    });
    expect(sms).not.toContain("2026-08-24T02:00:00.000Z");
    expect(sms).toContain("2026-08-23 19:00");
  });
});

/**
 * A link the recipient cannot open, that reports itself as sent. `window.location.origin`
 * is `capacitor://localhost` inside the shell, and the sender's own tap works because the
 * shell bundles /guardian/index.html — so nothing looks wrong from the hiker's side.
 */
describe("the origin a shared link is built from", () => {
  it("refuses a non-http origin instead of producing a dead link", async () => {
    const { shareableOrigin } = await import("@/lib/api/client");
    const original = globalThis.window;
    try {
      Object.defineProperty(globalThis, "window", {
        value: { location: { origin: "capacitor://localhost" } },
        configurable: true,
        writable: true,
      });
      expect(shareableOrigin()).toBeNull();
      Object.defineProperty(globalThis, "window", {
        value: { location: { origin: "https://klandagi.example" } },
        configurable: true,
        writable: true,
      });
      expect(shareableOrigin()).toBe("https://klandagi.example");
    } finally {
      Object.defineProperty(globalThis, "window", { value: original, configurable: true, writable: true });
    }
  });
});
