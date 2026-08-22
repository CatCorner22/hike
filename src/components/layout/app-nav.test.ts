import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ pathname: "/saved" }));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
}));

import { AppNav } from "./app-nav";

describe("AppNav", () => {
  it("offers Go and neutral Saved destinations on desktop and mobile", () => {
    const html = renderToStaticMarkup(createElement(AppNav));

    expect(html.match(/href="\/go"/g)).toHaveLength(2);
    expect(html.match(/href="\/saved"/g)).toHaveLength(2);
    expect(html).not.toContain('href="/offline"');
    expect(html.match(/aria-current="page"[^>]*href="\/saved"/g)).toHaveLength(2);
  });
});
