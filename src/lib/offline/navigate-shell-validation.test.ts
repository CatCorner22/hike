import { describe, expect, it } from "vitest";
import {
  isValidNavigateShellDocument,
  looksLikeNavigateHtml,
  NAVIGATE_ASSETS_CACHE,
  NAVIGATE_SHELL_CACHE,
  NAVIGATE_SHELL_MARKER,
} from "./navigate-shell-validation";

const VALID_HTML = `<!doctype html><html><body><!--${NAVIGATE_SHELL_MARKER}--><script src="/_next/static/chunks/main.js"></script></body></html>`.padEnd(
  600,
  " ",
);

describe("navigate shell validation", () => {
  it("accepts a marked Next-shaped document", () => {
    expect(looksLikeNavigateHtml(VALID_HTML)).toBe(true);
    expect(isValidNavigateShellDocument(VALID_HTML, "text/html", NAVIGATE_SHELL_MARKER)).toBe(true);
  });

  it("rejects a marker-only stub without Next assets", () => {
    const stub = `<!--${NAVIGATE_SHELL_MARKER}-->`.padEnd(600, "x");
    expect(isValidNavigateShellDocument(stub, "text/html", NAVIGATE_SHELL_MARKER)).toBe(false);
  });

  it("exports cache names aligned with the service worker", () => {
    expect(NAVIGATE_SHELL_CACHE).toBe("hike-navigate-shell");
    expect(NAVIGATE_ASSETS_CACHE).toBe("hike-navigate-assets");
  });
});
