import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import NavigateRouteLayout from "./layout";
import { NAVIGATE_SHELL_ROUTE_ID } from "@/lib/offline/navigate-shell-validation";

describe("navigate route layout", () => {
  /**
   * The shell marker must be present in the server-rendered document BEFORE
   * hydration: offline preparation fetches this HTML and the cache validator
   * refuses documents without it. With ?target= routing the marker is a fixed
   * shell id — one prerendered document serves every plan.
   */
  it("puts the shell marker in the server-rendered document", () => {
    const html = renderToStaticMarkup(
      NavigateRouteLayout({ children: createElement("main", null, "Loading route") }),
    );

    expect(html).toContain(`data-hike-navigate-shell="${NAVIGATE_SHELL_ROUTE_ID}"`);
    expect(html).toContain("Loading route");
  });
});
