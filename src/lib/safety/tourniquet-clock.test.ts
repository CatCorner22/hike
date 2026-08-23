import { describe, expect, it } from "vitest";
import { MAX_TOURNIQUET_BACKDATE_MS, formatZulu, shiftTourniquetApplied, tourniquetStatus, type TourniquetContext } from "./tccc";

const HOUR = 60 * 60 * 1000;

/** Every precondition CoTCCC requires, affirmed. This is the only shape that opens conversion. */
const CLEARED: TourniquetContext = {
  evacuationDelayed: true,
  inShock: false,
  amputation: false,
  alone: false,
};

/**
 * A tourniquet is the one intervention in this app that a user can undo, and
 * undoing it wrongly kills the casualty. The old version offered conversion to
 * anyone whose tourniquet was under two hours old, with no other condition --
 * so a solo hiker who had just stopped a femoral bleed was invited to convert
 * it two minutes later, alone, with no idea whether help was coming.
 */
describe("the conversion decision is gated on the conditions, not on the clock alone", () => {
  it("does not offer conversion when nothing has been confirmed", () => {
    const status = tourniquetStatus(0, 10 * 60_000);
    expect(status?.conversionWindow).toBe(false);
    expect(status?.conversionBlockers.length).toBeGreaterThan(0);
    expect(status?.message).toMatch(/Leave it in place/);
  });

  it("treats an unknown as a blocker rather than a clearance", () => {
    // Nothing is asserted about shock or amputation here -- only that evacuation
    // is delayed. Not knowing whether a casualty is in shock is not the same as
    // knowing they are not.
    const status = tourniquetStatus(0, 30 * 60_000, { evacuationDelayed: true });
    expect(status?.conversionWindow).toBe(false);
  });

  it("names each blocking condition so the rescuer knows which fact is missing", () => {
    const soloInShock = tourniquetStatus(0, 30 * 60_000, {
      evacuationDelayed: true,
      inShock: true,
      amputation: false,
      alone: true,
    });
    expect(soloInShock?.conversionBlockers.join(" ")).toMatch(/shock/i);
    expect(soloInShock?.conversionBlockers.join(" ")).toMatch(/only person here/i);

    const amputation = tourniquetStatus(0, 30 * 60_000, { ...CLEARED, amputation: true });
    expect(amputation?.conversionBlockers.join(" ")).toMatch(/amputation/i);

    const helpComing = tourniquetStatus(0, 30 * 60_000, { ...CLEARED, evacuationDelayed: false });
    expect(helpComing?.conversionBlockers.join(" ")).toMatch(/evacuation is delayed/i);
  });

  it("opens conversion only once every condition is affirmed, and says what to do if it bleeds again", () => {
    const status = tourniquetStatus(0, 30 * 60_000, CLEARED);
    expect(status?.conversionWindow).toBe(true);
    expect(status?.conversionBlockers).toEqual([]);
    expect(status?.message).toMatch(/re-tighten the tourniquet immediately/i);
  });

  it("closes conversion past 2 h no matter what has been confirmed", () => {
    const status = tourniquetStatus(0, 3 * HOUR, CLEARED);
    expect(status?.conversionWindow).toBe(false);
    expect(status?.conversionBlockers.join(" ")).toMatch(/evacuation/i);
  });

  it("never converts past 6 h, and never renders an empty reason", () => {
    const status = tourniquetStatus(0, 7 * HOUR, CLEARED);
    expect(status?.conversionWindow).toBe(false);
    expect(status?.message).toMatch(/Do not convert/);
    expect(status?.conversionBlockers.length).toBeGreaterThan(0);
  });

  it("keeps the blocker list empty exactly when the window is open", () => {
    for (const [elapsed, context] of [
      [10 * 60_000, {}],
      [10 * 60_000, CLEARED],
      [2.5 * HOUR, CLEARED],
      [8 * HOUR, {}],
    ] as const) {
      const status = tourniquetStatus(0, elapsed, context);
      expect(status).not.toBeNull();
      expect(status!.conversionBlockers.length === 0).toBe(status!.conversionWindow);
    }
  });
});

/**
 * The decision times are the thing a rescuer writes on their hand. Recomputing
 * "two hours from 1405Z" under stress is exactly where an hour goes missing.
 */
describe("the two decision boundaries are given as wall-clock times", () => {
  it("states the 2 h and 6 h marks in Zulu", () => {
    const applied = Date.parse("2026-08-20T14:05:00Z");
    const status = tourniquetStatus(applied, applied + 10 * 60_000);
    expect(status?.twoHourMark).toBe("1605Z");
    expect(status?.sixHourMark).toBe("2005Z");
  });

  it("rolls the marks past midnight without inventing a date", () => {
    const applied = Date.parse("2026-08-20T23:30:00Z");
    const status = tourniquetStatus(applied, applied + 60_000);
    expect(status?.twoHourMark).toBe("0130Z");
    expect(status?.sixHourMark).toBe("0530Z");
  });

  it("says UNKNOWN rather than printing Invalid Date", () => {
    expect(formatZulu(Number.NaN)).toBe("UNKNOWN");
    expect(formatZulu(8.64e15 * 10)).toBe("UNKNOWN");
    expect(formatZulu(Date.parse("2026-08-20T04:07:00Z"))).toBe("0407Z");
  });
});

/**
 * The clock could only ever start at "now". A hiker who stopped a femoral bleed
 * and reached their phone forty minutes later was told the tourniquet had been
 * on for zero minutes, which puts the 6 h boundary forty minutes late.
 */
describe("the recorded application time can be corrected backwards", () => {
  const now = Date.parse("2026-08-20T14:00:00Z");

  it("moves the time back by the requested amount", () => {
    const applied = now - 5 * 60_000;
    expect(shiftTourniquetApplied(applied, -30, now)).toBe(now - 35 * 60_000);
    // ...and the elapsed clock follows it, which is the whole point.
    expect(tourniquetStatus(shiftTourniquetApplied(applied, -30, now)!, now)?.minutes).toBe(35);
  });

  it("refuses to place a tourniquet in the future", () => {
    expect(shiftTourniquetApplied(now - 60_000, 30, now)).toBe(now);
    expect(shiftTourniquetApplied(now, 5, now)).toBe(now);
  });

  it("refuses a backdate older than a day, which would be a leftover record", () => {
    const clamped = shiftTourniquetApplied(now - 23 * 60 * 60_000, -180, now);
    expect(clamped).toBe(now - MAX_TOURNIQUET_BACKDATE_MS);
    // A 30 h elapsed reading would carry a rescuer past the 6 h decision on a
    // wound that is not there.
    expect(tourniquetStatus(clamped!, now)!.minutes).toBe(24 * 60);
  });

  it("returns null rather than a corrupt time when the record is unreadable", () => {
    expect(shiftTourniquetApplied(Number.NaN, -5, now)).toBeNull();
    expect(shiftTourniquetApplied(now, Number.NaN, now)).toBeNull();
  });
});

/**
 * A checkbox nobody has touched means "not confirmed", not "confirmed false".
 * The first cut of this screen put the words "this tourniquet is controlling an
 * amputation" in front of a rescuer whose only sin was not ticking a box.
 */
describe("an unchecked condition is reported as unconfirmed, not as a finding", () => {
  it("does not assert an amputation, shock, or solitude that nobody stated", () => {
    const text = tourniquetStatus(0, 20 * 60_000)!.conversionBlockers.join(" ");
    expect(text).not.toMatch(/is controlling an amputation/);
    expect(text).not.toMatch(/is showing signs of shock/);
    expect(text).not.toMatch(/You are the only person here/);
    expect(text).toMatch(/Not confirmed yet:/);
  });

  it("collapses the unconfirmed conditions into one readable line", () => {
    const blockers = tourniquetStatus(0, 20 * 60_000)!.conversionBlockers;
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toMatch(
      /Not confirmed yet: that this is not an amputation, that the casualty is out of shock, that someone can watch the wound and that evacuation is delayed\./,
    );
  });

  it("still states an asserted contraindication in its own words", () => {
    const stated = tourniquetStatus(0, 20 * 60_000, {
      amputation: true,
      inShock: true,
      alone: true,
      evacuationDelayed: false,
    })!.conversionBlockers;
    expect(stated).toHaveLength(4);
    expect(stated.join(" ")).not.toMatch(/Not confirmed yet/);
  });
});
