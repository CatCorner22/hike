import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import NavigateRouteLayout from "./layout";

describe("navigate route layout", () => {
  it("puts the exact requested route id in the server-rendered shell", async () => {
    const layout = await NavigateRouteLayout({
      children: createElement("main", null, "Loading route"),
      params: Promise.resolve({ planId: "plan-ci-probe" }),
    });

    const html = renderToStaticMarkup(layout);

    expect(html).toContain('data-hike-navigate-shell="plan-ci-probe"');
    expect(html).toContain("Loading route");
  });
});
