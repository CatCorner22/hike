export const NAVIGATE_SHELL_MARKER = "hike-navigate-shell-v2";
/**
 * The value of the layout's data-hike-navigate-shell attribute. One fixed shell
 * document serves every route: the plan identity travels in the ?target= query
 * and the route data lives in IndexedDB, so the document itself is plan-agnostic
 * and the route marker proves only "this is the navigate app shell", not which
 * plan it was fetched for.
 */
export const NAVIGATE_SHELL_ROUTE_ID = "shell";
export const NAVIGATE_SHELL_CACHE = "hike-navigate-shell";
/** Must match `cacheName` for /_next/static/ in src/sw.ts. */
export const NAVIGATE_ASSETS_CACHE = "hike-navigate-assets";
export const MIN_NAVIGATE_DOCUMENT_BYTES = 512;

const REWRITTEN_BODY_HEADERS = [
  "content-encoding",
  "content-length",
  "content-md5",
  "content-range",
  "digest",
  "etag",
  "transfer-encoding",
] as const;

/**
 * A fetched response body has already been decoded by the browser.  When that
 * text is stamped and wrapped in a new Response, representation metadata from
 * the wire no longer describes its bytes and can make a cached navigation fail
 * with a content-decoding error.  Preserve policy/cache headers, but discard
 * payload encodings, lengths, ranges, and validators tied to the old body.
 */
export function headersForRewrittenNavigateDocument(source: Headers): Headers {
  const headers = new Headers(source);
  for (const name of REWRITTEN_BODY_HEADERS) headers.delete(name);
  return headers;
}

/** Keep the HTML shell route away from Next RSC/data requests for the same URL. */
export function isNavigateDocumentRequest(
  pathname: string,
  method: string,
  rscHeader: string | null,
  routerPrefetchHeader: string | null,
): boolean {
  return (
    method === "GET" &&
    // The shell lives at the fixed /navigate path (the plan travels in
    // ?target=); tolerate the trailing-slash form the static build emits.
    (pathname === "/navigate" || pathname === "/navigate/") &&
    rscHeader !== "1" &&
    routerPrefetchHeader !== "1"
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Proves that a 200 response is the requested route screen, not a generic Next soft-error page. */
export function containsNavigateRouteMarker(document: string, navId: string): boolean {
  if (!navId || navId.length > 256) return false;
  return new RegExp(
    `data-hike-navigate-shell=["']${escapeRegExp(navId)}["']`,
  ).test(document);
}

/** Same predicate the service worker uses before serving a cached navigate document. */
export function looksLikeNavigateHtml(document: string): boolean {
  return (
    document.length >= MIN_NAVIGATE_DOCUMENT_BYTES &&
    /<!doctype html|<html[\s>]/i.test(document) &&
    /_next\/|self\.__next_f|<body[\s>]/i.test(document)
  );
}

export function isMarkedNavigateShell(
  html: string,
  markerHeader: string | null,
): boolean {
  return markerHeader === NAVIGATE_SHELL_MARKER || html.includes(NAVIGATE_SHELL_MARKER);
}

/** True when Cache Storage holds a document the worker may serve offline. */
export function isValidNavigateShellDocument(
  html: string,
  contentType: string,
  markerHeader: string | null,
  expectedNavId?: string,
  /**
   * Demand the version marker. The final check used to be
   * `isMarkedNavigateShell(...) || looksLikeNavigateHtml(...)`, and the second
   * disjunct is always true by the time it runs — so the marker requirement was
   * a tautology and the version kill-switch did nothing. Writers legitimately
   * validate an UNMARKED live document before stamping it, so the requirement
   * belongs only on the paths that decide whether to TRUST something already in
   * the cache.
   */
  requireMarker = false,
): boolean {
  if (!looksLikeNavigateHtml(html)) return false;
  if (expectedNavId && !containsNavigateRouteMarker(html, expectedNavId)) return false;
  if (
    contentType &&
    !contentType.toLowerCase().includes("text/html") &&
    !isMarkedNavigateShell(html, markerHeader)
  ) {
    return false;
  }
  return requireMarker ? isMarkedNavigateShell(html, markerHeader) : true;
}

/**
 * How long a cached `/_next/static/` asset may be served. The service worker
 * enforces this through its expiration plugin; readiness verification MUST use
 * the same number, or it reports a route trip-ready whose assets the worker
 * will already refuse to serve.
 */
export const NAVIGATE_ASSET_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * Query flag the shell warmer appends to its `/_next/static/` fetches so the
 * service worker lets them through to the network instead of answering from
 * the very cache the warm is refreshing. Without the bypass, re-preparing
 * re-stored the ORIGINAL response — original `Date` header included — so a
 * route re-prepared on day 29 of the 30-day asset window still went not-ready
 * on day 31, and no amount of re-preparing could ever reset the clock.
 */
export const NAVIGATE_WARM_BYPASS_PARAM = "__klandagi_warm";

export function stampNavigateShellHtml(html: string): string {
  return html.includes(NAVIGATE_SHELL_MARKER)
    ? html
    : `<!--${NAVIGATE_SHELL_MARKER}-->${html}`;
}
