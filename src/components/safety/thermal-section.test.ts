import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ThermalSection } from "./thermal-section";

/**
 * Hypothermia and heat illness need opposite treatment — insulate versus
 * immerse in cold water — and the panel used to render both, each with its own
 * severity badge, driven by a single shared "Altered mental status" checkbox
 * with no exposure asked for at all. Ticking it produced "Hypothermia:
 * moderate / WARNING — stop heat loss now, shelter and insulate" directly
 * beside "Heat illness: stroke / CRITICAL — cool immediately with cold-water
 * immersion". Following the app was worse than having no app.
 *
 * The library functions are each gated on evidence in their own domain now, but
 * the screen is where the contradiction would actually reach a person, so the
 * invariant is asserted here.
 */
describe("thermal triage never shows two opposite treatments at once", () => {
  const html = renderToStaticMarkup(createElement(ThermalSection));

  it("asks for exposure before offering either aid, and says why", () => {
    expect(html).toContain("Choose cold or heat exposure above");
    expect(html).toContain("opposite");
    // Neither assessment is rendered until the question is answered.
    expect(html).not.toContain("Hypothermia:");
    expect(html).not.toContain("Heat illness:");
  });

  it("offers exposure as one exclusive control, not two independent checkboxes", () => {
    // A single select, so cold and heat cannot both be true. (Its options live
    // in a portal and are not in the static markup — the control and its
    // default are what this render can see.)
    expect(html).toContain('id="thermal-exposure"');
    expect(html).toContain("Exposure (required");
    expect(html).toMatch(/value="unknown"/);
    // The old cold-exposure checkbox is gone; every remaining checkbox is a
    // sign, not an environment, so no single tick can drive both aids.
    expect(html).not.toContain('id="thermal-cold"');
    for (const sign of ["thermal-shiver", "thermal-altered", "thermal-conscious", "thermal-sweat", "thermal-cramps"]) {
      expect(html).toContain(`id="${sign}"`);
    }
  });

  it("keeps the treatments themselves out of the default render", () => {
    // The two first actions, verbatim from thermal.ts. Neither may appear
    // before an exposure is stated.
    expect(html).not.toContain("cold-water immersion");
    expect(html).not.toContain("Stop heat loss now");
  });
});
