import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PositionQr } from "./position-qr";

describe("position QR handoff", () => {
  it("renders a dark-on-white symbol with the spec quiet zone", () => {
    const html = renderToStaticMarkup(
      createElement(PositionQr, { payload: "11S KB 76448 38712", label: "Current position" }),
    );
    expect(html).toContain("as a QR code");
    expect(html).toContain('fill="#ffffff"');
    expect(html).toContain('fill="#000000"');
    // Quiet zone: the viewBox starts 4 modules before the symbol.
    expect(html).toMatch(/viewBox="-4 -4 /);
    expect(html).toContain("No signal, app, or pairing");
  });

  it("refuses an oversized payload with an actionable message instead of a broken code", () => {
    const html = renderToStaticMarkup(
      createElement(PositionQr, { payload: "x".repeat(3000), label: "SAR dossier" }),
    );
    expect(html).toContain("too long to fit in a QR code");
    expect(html).not.toContain("<svg");
  });
});
