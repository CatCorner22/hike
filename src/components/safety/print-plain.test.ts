import { describe, expect, it, vi } from "vitest";
import {
  printOrDownloadPlain,
  printPlain,
  printableDocument,
  type PrintablePopup,
} from "./print-plain";

function popupFixture(events: string[]) {
  let opener: unknown = { unsafeReference: true };
  let markup = "";
  const popup = {
    get opener() {
      return opener;
    },
    set opener(value: unknown) {
      events.push("clear opener");
      opener = value;
    },
    document: {
      open() {
        events.push("document open");
      },
      write(value: string) {
        events.push("write");
        markup = value;
      },
      close() {
        events.push("document close");
      },
    },
    focus() {
      events.push("focus");
    },
    print() {
      events.push("print");
    },
    close() {
      events.push("popup close");
    },
  } satisfies PrintablePopup;

  return { popup, markup: () => markup };
}

describe("plain-text printing", () => {
  it("clears the opener before writing a nonblank document and printing", () => {
    const events: string[] = [];
    const fixture = popupFixture(events);

    expect(printPlain("Route <one>", "ICE: A&B", () => fixture.popup)).toBe(true);
    expect(events).toEqual([
      "clear opener",
      "document open",
      "write",
      "document close",
      "focus",
      "print",
    ]);
    expect(fixture.popup.opener).toBeNull();
    expect(fixture.markup()).toContain("<title>Route &lt;one&gt;</title>");
    expect(fixture.markup()).toContain("ICE: A&amp;B");
  });

  it("escapes untrusted title and body values", () => {
    const html = printableDocument('</title><script src="x">', "<img onerror='x'>");

    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;/title&gt;");
    expect(html).toContain("&lt;img onerror=&#39;x&#39;&gt;");
  });

  it("downloads the exact text when the browser blocks the popup", () => {
    const download = vi.fn();

    expect(printOrDownloadPlain(
      { title: "Trail leave-behind", body: "trusted trip facts", filename: "trail.txt" },
      { openPopup: () => null, download },
    )).toBe("downloaded");
    expect(download).toHaveBeenCalledOnce();
    expect(download).toHaveBeenCalledWith("trail.txt", "trusted trip facts", "text/plain");
  });

  it("closes an unsafe popup and downloads when opener isolation fails", () => {
    const events: string[] = [];
    const download = vi.fn();
    const fixture = popupFixture(events);
    Object.defineProperty(fixture.popup, "opener", {
      configurable: true,
      get: () => ({ stillAttached: true }),
      set: () => events.push("refused opener clear"),
    });

    expect(printOrDownloadPlain(
      { title: "Trail leave-behind", body: "trip facts", filename: "trail.txt" },
      { openPopup: () => fixture.popup, download },
    )).toBe("downloaded");
    expect(events).toEqual(["refused opener clear", "popup close"]);
    expect(download).toHaveBeenCalledWith("trail.txt", "trip facts", "text/plain");
  });
});
