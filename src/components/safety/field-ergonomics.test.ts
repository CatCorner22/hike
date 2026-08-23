import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const button = read("src/components/ui/button.tsx");
const beacon = read("src/components/offline/sos-beacon.tsx");
const tccc = read("src/components/safety/tccc-section.tsx");
const readiness = read("src/components/offline/offline-readiness.tsx");

/**
 * Measured in the running app at 390 x 844 with a canvas pixel readback against
 * the page background (#ffffff): text-green-600 is 3.22:1 and text-amber-600 is
 * 3.20:1, both under the 4.5:1 that AA asks of body text. The -700 shades of the
 * same hues measure 4.95:1 and 5.03:1. Hue was doing luminance's job, so a
 * red-green colour-blind reader and a reader in sunlight both lost the signal.
 */
describe("status colour carries luminance, not only hue", () => {
  it("uses no status colour known to miss AA", () => {
    for (const [name, source] of [
      ["button", button],
      ["beacon", beacon],
      ["tccc", tccc],
      ["readiness", readiness],
      ["nav", read("src/components/layout/app-nav.tsx")],
      ["compass", read("src/components/navigate/compass-hud.tsx")],
      ["guide", read("src/app/guide/page.tsx")],
      ["panel", read("src/components/offline/safety-panel.tsx")],
    ] as const) {
      expect(source, `${name} still uses a sub-AA status colour`).not.toMatch(
        /text-(green|amber|yellow|lime)-600\b/,
      );
    }
  });
});

/**
 * The way out of a full-screen strobe has to be visible in both frames. The Stop
 * control was the app's secondary grey on a background alternating white and
 * black -- 1.09:1 against the light frame, which is invisible half the time on
 * the one screen where panic is the expected state.
 */
describe("the strobe can always be stopped and never ambushes", () => {
  it("gives the Stop control its own colour and an outline against both frames", () => {
    expect(beacon).toMatch(/bg-red-700/);
    expect(beacon).toMatch(/border-white/);
    expect(beacon).toMatch(/shadow-\[0_0_0_2px_#000\]/);
    expect(beacon).not.toMatch(/variant="secondary"/);
  });

  it("does not start flashing on a device that asked for reduced motion", () => {
    expect(beacon).toMatch(/prefers-reduced-motion: reduce/);
    expect(beacon).toMatch(/useState\(\(\) => !prefersReducedMotion\(\)\)/);
    // ...but it is still reachable, because being seen can matter more.
    expect(beacon).toMatch(/Start the screen flashing/);
  });
});

/**
 * Cold hands, gloves, wind, one hand busy. Apple asks for 44 pt; the default was
 * 32 px and "sm" was 28 px, which is what the button starting a tourniquet clock
 * measured.
 */
describe("tap targets are sized for the conditions", () => {
  it("puts the default button at the 44 px guidance and lifts the small one", () => {
    expect(button).toMatch(/default:\s*\n?\s*"h-11 /);
    expect(button).toMatch(/sm: "h-9 /);
    expect(button).toMatch(/icon: "size-11"/);
    expect(button).not.toMatch(/default:\s*\n?\s*"h-8 /);
  });

  it("opens the trauma walkthrough and the tourniquet clock instead of hiding them", () => {
    expect(tccc).toMatch(/<details open><summary[^>]*>MARCH-PAWS walkthrough/);
    expect(tccc).toMatch(/<details open><summary[^>]*>Tourniquet clock/);
  });

  it("prints the unconditional action before asking anyone to operate a menu", () => {
    const imperative = tccc.indexOf("tourniquet high and tight");
    const firstSelect = tccc.indexOf("<Select value={bleeding}");
    expect(imperative).toBeGreaterThan(-1);
    expect(imperative).toBeLessThan(firstSelect);
  });

  it("does not set the trauma card in 12-pixel type", () => {
    expect(tccc).not.toMatch(/CardContent className="space-y-3 text-xs"/);
    expect(tccc).not.toMatch(/text-\[10px\]/);
  });
});

/**
 * VoiceOver read this row out as "Nearby coverage recorded; context not saved.
 * Pass." It was the only row in the list whose pass mark and title disagreed.
 */
describe("a pass mark means what the row says", () => {
  it("requires the saved context, not merely a recorded coverage target", () => {
    expect(readiness).toMatch(/ok=\{Boolean\(packReady && state\.corridor && state\.corridorFeatures\)\}/);
  });
});

/**
 * CoreLocation and the W3C Geolocation API both report a non-positive accuracy
 * to mean "no valid estimate". Printing that as "about 0 m" converts a missing
 * measurement into a claim of a perfect one.
 */
describe("a missing accuracy is never rendered as zero metres", () => {
  it("guards the mark-this-place accuracy line on a positive finite value", () => {
    const capture = read("src/components/offline/field-capture.tsx");
    expect(capture).toMatch(/accuracyM != null && Number\.isFinite\(accuracyM\) && accuracyM > 0/);
    expect(capture).toMatch(/No accuracy estimate came with this fix/);
  });
});
