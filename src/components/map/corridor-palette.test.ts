import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/components/map/safety-nav-map.tsx"),
  "utf8",
);

type Rgb = [number, number, number];

function parseHex(hex: string): Rgb {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
}

/** sRGB relative luminance, the same measure the other colour tests here use. */
function luminance(rgb: Rgb): number {
  const linear = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/** Source-over compositing, which is what the canvas does at a given globalAlpha. */
function over(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  return fg.map((v, i) => Math.round(v * alpha + bg[i] * (1 - alpha))) as Rgb;
}

/**
 * Weber contrast — how far a feature sits from the ground it lies on, as a
 * fraction of that ground.
 *
 * Deliberately not the WCAG ratio the text tests in this repo use. That formula
 * adds 0.05 to both terms to model screen flare, which is right for text on a
 * page and useless here: this map runs between 0.002 and 0.09 luminance, where
 * the 0.05 dominates and every ratio collapses toward 1:1 whatever the colours
 * are. It would report the night palette as failing and a near-invisible line as
 * passing, in the same breath. Weber has no such floor.
 */
function weberContrast(feature: number, backdrop: number): number {
  return Math.abs(feature - backdrop) / Math.max(backdrop, 1e-6);
}

/**
 * Every value below is read out of the component rather than copied here.
 *
 * A test that hard-codes the palette keeps passing after someone changes it,
 * which is the failure mode that matters: it would report a contract it is no
 * longer measuring. So each read asserts it actually found something, and a
 * refactor that moves these colours fails this file loudly instead of quietly
 * proving nothing.
 */
function readOrFail(pattern: RegExp, what: string, haystack = source): RegExpMatchArray {
  const found = haystack.match(pattern);
  expect(found, `could not read ${what} from safety-nav-map.tsx — this test is
    parsing a shape the component no longer has, so it is no longer checking
    anything. Re-point it at the new shape rather than deleting it.`).not.toBeNull();
  return found as RegExpMatchArray;
}

const MODES = ["day", "red", "nvg"] as const;
type Mode = (typeof MODES)[number];

const ground = readOrFail(
  /ctx\.fillStyle =\s*\n?\s*nightMode === "red" \? "(#[0-9a-f]{6})" : nightMode === "nvg" \? "(#[0-9a-f]{6})" : "(#[0-9a-f]{6})";/,
  "the canvas background",
);
const GROUND: Record<Mode, Rgb> = {
  red: parseHex(ground[1]),
  nvg: parseHex(ground[2]),
  day: parseHex(ground[3]),
};

const routeStroke = readOrFail(
  /ctx\.strokeStyle = nightMode === "red" \? "(#[0-9a-f]{6})" : "(#[0-9a-f]{6})";\s*\n\s*ctx\.lineWidth = 5;/,
  "the route line colour",
);
// The route has no separate night-vision branch; nvg shares the day colour.
const ROUTE: Record<Mode, Rgb> = {
  red: parseHex(routeStroke[1]),
  nvg: parseHex(routeStroke[2]),
  day: parseHex(routeStroke[2]),
};

const corridorBlock = readOrFail(
  /const lineColor = \(layer: string\) => \{([\s\S]*?)\};/,
  "the corridor line palette",
)[1];

// Read the branches the way the component branches: the night modes each collapse
// to one colour before any layer is considered, and the rest is the day palette.
const redLine = readOrFail(
  /if \(nightMode === "red"\) return "(#[0-9a-f]{6})";/,
  "the red-mode corridor colour",
  corridorBlock,
)[1];
const nvgLine = readOrFail(
  /if \(nightMode === "nvg"\) return "(#[0-9a-f]{6})";/,
  "the night-vision corridor colour",
  corridorBlock,
)[1];
const dayLines = [
  ...corridorBlock
    .replace(/if \(nightMode === "(?:red|nvg)"\) return "#[0-9a-f]{6}";/g, "")
    .matchAll(/"(#[0-9a-f]{6})"/g),
].map((m) => m[1]);

const CORRIDOR: Record<Mode, string[]> = { day: dayLines, red: [redLine], nvg: [nvgLine] };

const CORRIDOR_ALPHA = Number(
  readOrFail(
    /ctx\.globalAlpha = ([0-9.]+);\s*\n\s*ctx\.strokeStyle = lineColor\(layer\);/,
    "the corridor line alpha",
  )[1],
);

/*
  The corridor is not drawn on the bare canvas. When a pack carries elevation the
  relief quads go down first, so the ground under a corridor line is a tinted
  cell, not the background colour. Read that layer too — measuring against bare
  ground answers a question about a map nobody is looking at.
*/
const tint = readOrFail(
  /const tint =\s*\n?\s*nightMode === "red" \? \[([^\]]+)\] : nightMode === "nvg" \? \[([^\]]+)\] : \[([^\]]+)\];/,
  "the relief tint",
);
const asRgb = (list: string): Rgb =>
  list.split(",").map((n) => Number(n.trim())) as Rgb;
const TINT: Record<Mode, Rgb> = {
  red: asRgb(tint[1]),
  nvg: asRgb(tint[2]),
  day: asRgb(tint[3]),
};

const shadeLevel = readOrFail(
  /const level = ([0-9.]+) \+ value \* ([0-9.]+);/,
  "the relief brightness range",
);
const SHADE_BASE = Number(shadeLevel[1]);
const SHADE_SPAN = Number(shadeLevel[2]);

const QUAD_ALPHA = Number(
  readOrFail(
    /Math\.round\(tint\[2\] \* level\)\}, ([0-9.]+)\)/,
    "the relief quad alpha",
  )[1],
);

/**
 * Every ground a corridor line can lie on: the bare canvas (a pack with no
 * elevation), and a relief cell at any hillshade value. Flat ground is not the
 * quiet case: with the shader's default 45-degree sun a level cell returns 0.71,
 * not 0. So the range has to be swept rather than sampled at one convenient
 * point.
 */
function backdrops(mode: Mode): Array<{ label: string; rgb: Rgb }> {
  const list = [{ label: "bare ground", rgb: GROUND[mode] }];
  for (let step = 0; step <= 20; step += 1) {
    const value = step / 20;
    const level = SHADE_BASE + value * SHADE_SPAN;
    const quad = TINT[mode].map((c) => Math.round(c * level)) as Rgb;
    list.push({
      label: `relief at hillshade ${value.toFixed(2)}`,
      rgb: over(quad, QUAD_ALPHA, GROUND[mode]),
    });
  }
  return list;
}

function brightestBackdrop(mode: Mode): { label: string; rgb: Rgb } {
  return backdrops(mode).reduce((max, b) =>
    luminance(b.rgb) > luminance(max.rgb) ? b : max,
  );
}

/**
 * A line on this map is an instruction: follow me. The route is the only line
 * entitled to say that, and brightness is what the eye sorts by first — before
 * hue, and long before width, on a phone held at arm's length in daylight.
 *
 * The corridor draws roads, trails and water around the route so a hiker who is
 * off the line can see which way is out. Those have to be visible and they have
 * to stay quieter than the route, or a side trail reads as the way to go.
 *
 * Nothing guaranteed that, and the gap was real rather than theoretical. The day
 * trail colour was #86efac: over bare ground its 0.55 alpha landed it at 0.21,
 * safely under the route's 0.27, and that is the number an earlier version of
 * this file measured. But a prepared route shows relief, and over a sunlit cell
 * the same stroke composited to 0.33 — brighter than the route, in nearly the
 * route's own hue, on exactly the maps that have terrain to get lost in. It is
 * now #22c55e, which holds at 0.22 against the brightest cell the shader can
 * produce.
 */
describe("no corridor line outshines the route it sits beside", () => {
  it("reads a palette that is actually there", () => {
    expect(CORRIDOR.day.length).toBeGreaterThanOrEqual(3);
    expect(CORRIDOR.red).toHaveLength(1);
    expect(CORRIDOR.nvg).toHaveLength(1);
    expect(CORRIDOR_ALPHA).toBeGreaterThan(0);
    expect(CORRIDOR_ALPHA).toBeLessThanOrEqual(1);
    expect(QUAD_ALPHA).toBeGreaterThan(0);
    expect(QUAD_ALPHA).toBeLessThanOrEqual(1);
    // A relief layer that never brightens the ground would make the sweep below
    // a no-op dressed up as coverage.
    expect(SHADE_SPAN).toBeGreaterThan(0);
    for (const mode of MODES) {
      expect(luminance(brightestBackdrop(mode).rgb)).toBeGreaterThan(
        luminance(GROUND[mode]),
      );
    }
  });

  for (const mode of MODES) {
    it(`keeps every corridor line below the route in ${mode} mode`, () => {
      const routeLuminance = luminance(ROUTE[mode]);
      const worst = brightestBackdrop(mode);
      for (const colour of CORRIDOR[mode]) {
        const seen = luminance(over(parseHex(colour), CORRIDOR_ALPHA, worst.rgb));
        expect(
          seen,
          `corridor colour ${colour} at alpha ${CORRIDOR_ALPHA} reads ${seen.toFixed(
            3,
          )} on ${worst.label} against the route's ${routeLuminance.toFixed(
            3,
          )} in ${mode} mode — a line brighter than the route tells a hiker to follow it`,
        ).toBeLessThan(routeLuminance);
      }
    });
  }

  /*
    The other half of the contract: subordinate is not the same as invisible, and
    a fix for the rule above must not be "make it black". This has to bind on
    every backdrop, because the relief cell that hides a line is not the one that
    made it too bright.

    0.25 is a floor for "a thin line is perceptibly there" — roughly an order of
    magnitude above the Weber threshold for detecting a large uniform patch,
    scaled up because this is a 1.5 px stroke seen through daylight glare or by a
    dark-adapted eye. It is not a claim of WCAG-grade legibility, which a
    deliberately quiet line could not meet without ceasing to be quiet. The
    palette's own tightest case sits at 0.44, so this leaves real headroom rather
    than tracing the current values.
  */
  const PERCEPTIBLE = 0.25;

  for (const mode of MODES) {
    it(`still draws the corridor bright enough to be seen at all in ${mode} mode`, () => {
      for (const colour of CORRIDOR[mode]) {
        for (const backdrop of backdrops(mode)) {
          const seen = luminance(over(parseHex(colour), CORRIDOR_ALPHA, backdrop.rgb));
          const contrast = weberContrast(seen, luminance(backdrop.rgb));
          expect(
            contrast,
            `corridor colour ${colour} reads ${contrast.toFixed(
              3,
            )} Weber contrast against ${backdrop.label} in ${mode} mode — below ${PERCEPTIBLE} the line stops separating from the ground it is drawn on`,
          ).toBeGreaterThanOrEqual(PERCEPTIBLE);
        }
      }
    });
  }
});
