import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PioneerAdvisor } from "./pioneer-advisor";

describe("PioneerAdvisor", () => {
  it("renders the one-way observational panel without a chat box", () => {
    const html = renderToStaticMarkup(createElement(PioneerAdvisor, {
      trailName: "Example Ridge Trail",
      packReady: false,
      tripReady: false,
    }));
    expect(html).toContain("Pioneer");
    expect(html).toContain("advisor-pioneer");
    expect(html).toContain("observes");
    expect(html).not.toMatch(/<textarea/i);
    expect(html).not.toMatch(/was this helpful/i);
    expect(html).not.toMatch(/thumbs/i);
  });
});
