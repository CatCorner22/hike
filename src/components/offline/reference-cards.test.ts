import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bearSafetyCard, wildernessFirstAidCard } from "@/lib/safety/wilderness";
import { mgrsGridTips } from "@/lib/safety/mgrs-grid";
import { backstopChecklist } from "@/lib/safety/wayfinding";
import { huntingBasics } from "@/lib/safety/survival-harvest";

/**
 * Five reference cards were rendered through `.slice(0, 4)` or `.slice(0, 5)`,
 * silently dropping their last entries. The two that mattered most:
 *
 *   wildernessFirstAidCard()[6] — "Allergic reaction: epinephrine auto-injector
 *   if prescribed" — the ONLY anaphylaxis guidance anywhere in this codebase,
 *   for the one emergency where a layperson holds the definitive drug in their
 *   own pocket.
 *
 *   bearSafetyCard()[6] — "If attacked by a black bear — fight back. Grizzly
 *   brown bear — play dead unless predatory." — the one line on that card where
 *   getting it backwards is fatal.
 *
 * A truncation like this is invisible: the card looks complete. So the guard is
 * on the source, not on a rendered string.
 */
const PANEL = readFileSync("src/components/offline/safety-panel.tsx", "utf8");

describe("reference cards are rendered whole", () => {
  it.each([
    ["bearSafetyCard", bearSafetyCard],
    ["wildernessFirstAidCard", wildernessFirstAidCard],
    ["mgrsGridTips", mgrsGridTips],
    ["backstopChecklist", backstopChecklist],
    ["huntingBasics", huntingBasics],
  ])("%s is mapped without a slice", (name, card) => {
    expect(card().length).toBeGreaterThan(4);
    expect(PANEL).toContain(`${name}().map(`);
    expect(PANEL).not.toMatch(new RegExp(`${name}\\(\\)\\.slice\\(`));
  });

  it("keeps the two lines whose loss is measured in lives", () => {
    const firstAid = wildernessFirstAidCard();
    expect(firstAid.some((line) => /epinephrine auto-injector/i.test(line))).toBe(true);
    const bear = bearSafetyCard();
    expect(bear.some((line) => /black bear — fight back/i.test(line))).toBe(true);
    expect(bear.some((line) => /play dead/i.test(line))).toBe(true);
  });
});
