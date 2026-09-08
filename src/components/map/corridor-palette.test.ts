import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/components/map/safety-nav-map.tsx"),
  "utf8",
);

/** sRGB relative luminance, the same measure the other colour tests here use. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const linear = channels.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/** What the eye actually receives: the stroke composited onto the ground at its alpha. */
function composited(hex: string, alpha: number, over: string): number {
  const fg = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const bg = [1, 3, 5].map((i) => parseInt(over.slice(i, i + 2), 16));
  const mixed = fg.map((v, i) => Math.round(v * alpha + bg[i] * (1 - alpha)));
  const toHex = (v: number) => v.toString(16).padStart(2, "0");
  return luminance(`#${mixed.map(toHex).join("")}`);
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
function readOrFail(pattern: RegExp, what: string): RegExpMatchArray {
  const found = source.match(pattern);
  expect(found, `could not read ${what} from safety-nav-map.tsx — this test is
    parsing a shape the component no longer has, so it is no longer checking
    anything. Re-point it at the new shape rather than deleting it.`).not.toBeNull();
  return found as RegExpMatchArray;
}

const ground = readOrFail(
  /ctx\.fillStyle =\s*\n?\s*nightMode === "red" \? "(#[0-9a-f]{6})" : nightMode === "nvg" \? "(#[0-9a-f]{6})" : "(#[0-9a-f]{6})";/,
  "the canvas background",
);
const GROUND = { red: ground[1], nvg: ground[2], day: ground[3] };

const routeStroke = readOrFail(
  /ctx\.strokeStyle = nightMode === "red" \? "(#[0-9a-f]{6})" : "(#[0-9a-f]{6})";\s*\n\s*ctx\.lineWidth = 5;/,
  "the route line colour",
);
// The route has no separate night-vision branch; nvg shares the day colour.
const ROUTE = { red: routeStroke[1], nvg: routeStroke[2], day: routeStroke[2] };

const corridorBlock = readOrFail(
  /const lineColor = \(layer: string\) => \{([\s\S]*?)\};/,
  "the corridor line palette",
)[1];
const CORRIDOR_COLOURS = [...corridorBlock.matchAll(/"(#[0-9a-f]{6})"/g)].map((m) => m[1]);

const corridorAlpha = Number(
  readOrFail(
    /ctx\.globalAlpha = ([0-9.]+);\s*\n\s*ctx\.strokeStyle = lineColor\(layer\);/,
    "the corridor line alpha",
  )[1],
);

/**
 * A line on this map is an instruction: follow me. The route is the only line
 * entitled to say that, and brightness is what the eye sorts by first — before
 * hue, and long before width, on a phone held at arm's length in daylight.
 *
 * The corridor draws roads, trails and water around the route so a hiker who is
 * off the line can see which way is out. Those have to be visible and they have
 * to stay quieter than the route, or a side trail reads as the way to go.
 *
 * Nothing guaranteed that. Measured on the current palette, the raw trail colour
 * #86efac has luminance 0.70 against the route's 0.27 — two and a half times
 * brighter, in nearly the route's own hue. What saves it is the 0.55 alpha it is
 * drawn at, which lands it at 0.21. That is a real margin, but it is an
 * accident of one number sitting in the draw call, and removing the alpha would
 * silently invert the map's most important signal.
 */
describe("no corridor line outshines the route it sits beside", () => {
  it("reads a palette that is actually there", () => {
    expect(CORRIDOR_COLOURS.length).toBeGreaterThanOrEqual(3);
    expect(corridorAlpha).toBeGreaterThan(0);
    expect(corridorAlpha).toBeLessThanOrEqual(1);
  });

  for (const mode of ["day", "red", "nvg"] as const) {
    it(`keeps every corridor line below the route in ${mode} mode`, () => {
      const routeLuminance = luminance(ROUTE[mode]);
      for (const colour of CORRIDOR_COLOURS) {
        const seen = composited(colour, corridorAlpha, GROUND[mode]);
        expect(
          seen,
          `corridor colour ${colour} at alpha ${corridorAlpha} reads ${seen.toFixed(
            3,
          )} against the route's ${routeLuminance.toFixed(
            3,
          )} in ${mode} mode — a line brighter than the route tells a hiker to follow it`,
        ).toBeLessThan(routeLuminance);
      }
    });
  }

  it("still draws the corridor bright enough to be seen at all", () => {
    // The other half of the contract: subordinate is not the same as invisible,
    // and a fix for the line above must not be "make it black".
    for (const mode of ["day", "red", "nvg"] as const) {
      for (const colour of CORRIDOR_COLOURS) {
        const seen = composited(colour, corridorAlpha, GROUND[mode]);
        const groundLuminance = luminance(GROUND[mode]);
        expect(
          seen,
          `corridor colour ${colour} is indistinguishable from the background in ${mode} mode`,
        ).toBeGreaterThan(groundLuminance);
      }
    }
  });
});
