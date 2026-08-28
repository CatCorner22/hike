import { describe, expect, it } from "vitest";
import {
  containsNavigateRouteMarker,
  headersForRewrittenNavigateDocument,
  isNavigateDocumentRequest,
  isValidNavigateShellDocument,
  looksLikeNavigateHtml,
  NAVIGATE_ASSETS_CACHE,
  NAVIGATE_SHELL_CACHE,
  NAVIGATE_SHELL_MARKER,
  NAVIGATE_ASSET_MAX_AGE_SECONDS,
  MAX_NAVIGATE_ASSETS,
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

  /**
   * Regression: the final check was
   * `isMarkedNavigateShell(...) || looksLikeNavigateHtml(...)`, and the second
   * disjunct is already true by the time it runs — so the marker requirement
   * was a tautology and the version kill-switch could never reject a shell
   * cached by an older release.
   */
  it("actually enforces the marker when a cached document must be trusted", () => {
    const unmarked = VALID_HTML.replace(`<!--${NAVIGATE_SHELL_MARKER}-->`, "");
    // Writers validate an unmarked live document before stamping it.
    expect(isValidNavigateShellDocument(unmarked, "text/html", null, "plan-123")).toBe(true);
    // Cached-trust readers must refuse it.
    expect(isValidNavigateShellDocument(unmarked, "text/html", null, "plan-123", true)).toBe(false);
    // A marker in the body or the header both count.
    expect(isValidNavigateShellDocument(VALID_HTML, "text/html", null, "plan-123", true)).toBe(true);
    expect(
      isValidNavigateShellDocument(unmarked, "text/html", NAVIGATE_SHELL_MARKER, "plan-123", true),
    ).toBe(true);
    // A shell stamped by a DIFFERENT marker version is rejected — the point of
    // having a version at all.
    const otherVersion = unmarked.replace("<body>", "<body><!--hike-navigate-shell-v1-->");
    expect(isValidNavigateShellDocument(otherVersion, "text/html", null, "plan-123", true)).toBe(false);
  });

  it("keeps the worker's asset lifetime and readiness verification on one number", () => {
    // Readiness used to apply no age rule at all, so it reported trip-ready for
    // assets the worker's expiration plugin would already refuse to serve.
    expect(NAVIGATE_ASSET_MAX_AGE_SECONDS).toBe(60 * 60 * 24 * 30);
    expect(MAX_NAVIGATE_ASSETS).toBe(500);
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

  it("handles shell requests without stealing Next RSC data requests", () => {
    // The shell lives at the fixed /navigate path; the plan travels in ?target=
    // (the query never reaches this pathname predicate). Tolerate the
    // trailing-slash form the static build emits.
    expect(isNavigateDocumentRequest("/navigate", "GET", null, null)).toBe(true);
    expect(isNavigateDocumentRequest("/navigate/", "GET", null, null)).toBe(true);
    // Cache-warming fetches and Chromium navigations do not expose one stable
    // mode/destination pair. Next's RSC headers are the reliable exclusion.
    expect(isNavigateDocumentRequest("/navigate", "GET", "0", null)).toBe(true);
    expect(isNavigateDocumentRequest("/navigate", "GET", "1", null)).toBe(false);
    expect(isNavigateDocumentRequest("/navigate", "GET", null, "1")).toBe(false);
    expect(isNavigateDocumentRequest("/navigate", "POST", null, null)).toBe(false);
    // Old-style per-plan paths no longer exist and must fall to the app's
    // ordinary offline fallback, not the shell handler.
    expect(isNavigateDocumentRequest("/navigate/plan-123", "GET", null, null)).toBe(false);
    expect(isNavigateDocumentRequest("/plan/plan-123", "GET", null, null)).toBe(false);
  });
});
