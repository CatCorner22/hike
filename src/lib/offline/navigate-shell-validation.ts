export const NAVIGATE_SHELL_MARKER = "hike-navigate-shell-v2";
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
  mode: string,
): boolean {
  return method === "GET" && mode === "navigate" && pathname.startsWith("/navigate/");
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
  return isMarkedNavigateShell(html, markerHeader) || looksLikeNavigateHtml(html);
}

export function stampNavigateShellHtml(html: string): string {
  return html.includes(NAVIGATE_SHELL_MARKER)
    ? html
    : `<!--${NAVIGATE_SHELL_MARKER}-->${html}`;
}
