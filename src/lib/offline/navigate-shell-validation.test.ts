import { describe, expect, it } from "vitest";
import {
  containsNavigateRouteMarker,
  headersForRewrittenNavigateDocument,
  isValidNavigateShellDocument,
  looksLikeNavigateHtml,
  NAVIGATE_ASSETS_CACHE,
  NAVIGATE_SHELL_CACHE,
  NAVIGATE_SHELL_MARKER,
} from "./navigate-shell-validation";

const VALID_HTML = `<!doctype html><html><body><main data-hike-navigate-shell="plan-123"><!--${NAVIGATE_SHELL_MARKER}--><script src="/_next/static/chunks/main.js"></script></main></body></html>`.padEnd(
  600,
  " ",
);

describe("navigate shell validation", () => {
  it("accepts a marked Next-shaped document", () => {
    expect(looksLikeNavigateHtml(VALID_HTML)).toBe(true);
    expect(isValidNavigateShellDocument(VALID_HTML, "text/html", NAVIGATE_SHELL_MARKER)).toBe(true);
    expect(isValidNavigateShellDocument(VALID_HTML, "text/html", NAVIGATE_SHELL_MARKER, "plan-123")).toBe(true);
  });

  it("proves that the cached document belongs to the requested route", () => {
    expect(containsNavigateRouteMarker(VALID_HTML, "plan-123")).toBe(true);
    expect(containsNavigateRouteMarker(VALID_HTML, "plan-999")).toBe(false);
    expect(isValidNavigateShellDocument(VALID_HTML, "text/html", NAVIGATE_SHELL_MARKER, "plan-999")).toBe(false);
  });

  it("treats route ids as literal text instead of regular expressions", () => {
    const html = VALID_HTML.replace("plan-123", "trail-a.b+[1]");
    expect(containsNavigateRouteMarker(html, "trail-a.b+[1]")).toBe(true);
    expect(containsNavigateRouteMarker(html, "trail-axb+[1]")).toBe(false);
  });

  it("rejects a marker-only stub without Next assets", () => {
    const stub = `<!--${NAVIGATE_SHELL_MARKER}-->`.padEnd(600, "x");
    expect(isValidNavigateShellDocument(stub, "text/html", NAVIGATE_SHELL_MARKER)).toBe(false);
  });

  it("exports cache names aligned with the service worker", () => {
    expect(NAVIGATE_SHELL_CACHE).toBe("hike-navigate-shell");
    expect(NAVIGATE_ASSETS_CACHE).toBe("hike-navigate-assets");
  });

  it("drops stale representation headers when a decoded shell body is rewritten", () => {
    const headers = headersForRewrittenNavigateDocument(new Headers({
      "content-encoding": "br",
      "content-length": "123",
      etag: '"old-body"',
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": "default-src 'self'",
    }));

    expect(headers.get("content-encoding")).toBeNull();
    expect(headers.get("content-length")).toBeNull();
    expect(headers.get("etag")).toBeNull();
    expect(headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(headers.get("content-security-policy")).toBe("default-src 'self'");
  });
});
