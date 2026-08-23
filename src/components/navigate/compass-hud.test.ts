import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CompassHud } from "./compass-hud";

/**
 * `grep -rn CompassHud **\/*.test.*` returned nothing before this file, and the
 * component had a defect visible at a glance once you looked: the card rotated
 * by -heading in heading-up mode while the needle rotated by +heading in a
 * group OUTSIDE the card, so the needle read TWICE the heading against the dial
 * beneath it. Heading 180 pointed 000. Heading 090 pointed 180. Heading-up is
 * the shipped default, so it was live the moment any heading arrived.
 *
 * The invariant that closes the whole class: the needle's angle measured
 * against the card equals the heading, in either mode.
 */
function rotations(html: string): number[] {
  return [...html.matchAll(/rotate\(([-\d.]+) /g)].map((match) => Number(match[1])); 
}

describe("compass needle against its own card", () => {
  for (const heading of [0, 45, 90, 180, 270, 359]) {
    it(`reads ${heading} against the card in north-up`, () => {
      const html = renderToStaticMarkup(
        createElement(CompassHud, { headingTrue: heading, lat: 37.7, lng: -119.6, headingUp: false }),
      );
      const [card, needle] = rotations(html);
      expect(((needle - card) % 360 + 360) % 360).toBeCloseTo(heading, 3);
      expect(card).toBe(0);
    });

    it(`reads ${heading} against the card in heading-up, with the needle at the top`, () => {
      const html = renderToStaticMarkup(
        createElement(CompassHud, { headingTrue: heading, lat: 37.7, lng: -119.6, headingUp: true }),
      );
      const [card, needle] = rotations(html);
      expect(((needle - card) % 360 + 360) % 360).toBeCloseTo(heading, 3);
      // Heading-up means the direction you are facing points up the screen.
      expect(((needle % 360) + 360) % 360).toBeCloseTo(0, 3);
    });
  }

  it("does not rotate anything when there is no heading to rotate by", () => {
    const html = renderToStaticMarkup(
      createElement(CompassHud, { headingTrue: null, lat: 37.7, lng: -119.6, headingUp: true }),
    );
    expect(rotations(html)).toEqual([0]);
  });
});
