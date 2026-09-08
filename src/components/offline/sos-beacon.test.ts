import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SosBeacon } from "./sos-beacon";

describe("sound and flash locator", () => {
  it("labels the local signal honestly and says it does not contact rescue", () => {
    const html = renderToStaticMarkup(createElement(SosBeacon, { onClose: () => {} }));

    expect(html).toContain('aria-label="Sound &amp; flash locator"');
    expect(html).toContain("Sound &amp; flash locator");
    expect(html).toContain("Does not contact 911, SAR, or transmit your location.");
    expect(html).not.toContain("SOS locator beacon");
    expect(html).not.toContain("Stop beacon");
  });
});
