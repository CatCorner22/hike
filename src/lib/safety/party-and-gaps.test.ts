import { describe, expect, it } from "vitest";
import { partySizeLine } from "./party";
import { hikeReadiness, summarizeGaps } from "./readiness";
import { formatLeaveBehindCard } from "./leave-behind";
import { emergencyMessage } from "./emergency";

const CONFIRMED = { partySize: 9, partySizeConfirmed: true };
const DEFAULTED = { partySize: 1 };

/**
 * A scout leader takes nine people out. Party size only ever existed behind the
 * navigate gate, so a fresh install printed "Party size: 1" on the leave-behind
 * card -- and one searcher went looking for one person.
 */
describe("the party size is only stated when somebody stated it", () => {
  it("prints a confirmed number", () => {
    expect(partySizeLine(CONFIRMED)).toBe("9");
    expect(partySizeLine({ partySize: 1, partySizeConfirmed: true })).toBe("1");
  });

  it("refuses to pass the default off as a fact, and says what to do instead", () => {
    expect(partySizeLine(DEFAULTED)).toMatch(/not stated/);
    expect(partySizeLine(DEFAULTED)).toMatch(/ask the contact/);
  });

  it("treats a corrupt confirmed number as unstated rather than printing it", () => {
    for (const size of [0, -3, Number.NaN, null, undefined]) {
      expect(partySizeLine({ partySize: size, partySizeConfirmed: true })).toMatch(/not stated/);
    }
  });

  it("carries the same rule onto both cards a rescuer reads", () => {
    const profile = {
      name: "Pat",
      iceName: "Sam",
      icePhone: "+15555550123",
      medical: "",
      ...DEFAULTED,
    };
    const leaveBehind = formatLeaveBehindCard({
      trailName: "Ridge loop",
      geometry: { type: "LineString", coordinates: [[-119.6, 37.75], [-119.58, 37.76]] },
      profile,
      returnAt: "2026-08-21T02:00:00.000Z",
    });
    expect(leaveBehind).toMatch(/Party size: not stated/);
    expect(leaveBehind).not.toMatch(/Party size: 1\b/);

    const sos = emergencyMessage({ lat: 37.75, lng: -119.6, profile });
    expect(sos).toMatch(/Party size: not stated/);

    const stated = emergencyMessage({ lat: 37.75, lng: -119.6, profile: { ...profile, ...CONFIRMED } });
    expect(stated).toMatch(/Party size: 9/);
  });
});

/**
 * The HUD joined the validator's own sentences with commas, so a hiker who
 * skipped the gate read "Not set up: ICE contact is unusable: ICE phone is
 * required., Planned return time." The two audiences now get two strings.
 */
describe("what is missing reads as prose in prose and as a complaint in a form", () => {
  const empty = { name: "", iceName: "", icePhone: "", medical: "", partySize: 1 };

  it("keeps the validator's own words for the field that fixes it", () => {
    const gaps = hikeReadiness({ packReady: true, profile: empty, returnAt: null }).missing;
    expect(gaps.map((gap) => gap.detail).join(" ")).toMatch(/ICE contact is unusable/);
  });

  it("joins into one sentence with no punctuation seams", () => {
    const summary = summarizeGaps(
      hikeReadiness({ packReady: false, profile: empty, returnAt: null }).missing,
    );
    expect(summary).not.toMatch(/\.,/);
    expect(summary).not.toMatch(/\.\s*$/);
    expect(summary).not.toMatch(/:/);
    expect(`Still not set up: ${summary}.`).toBe(
      "Still not set up: the offline route on this device, your name, an emergency contact name, a working emergency contact number, a planned return time.",
    );
  });

  it("says nothing when nothing is missing", () => {
    const result = hikeReadiness({
      packReady: true,
      profile: { ...empty, name: "Pat", iceName: "Sam", icePhone: "+15555550123" },
      returnAt: "2026-08-21T02:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    expect(summarizeGaps(result.missing)).toBe("");
  });
});
