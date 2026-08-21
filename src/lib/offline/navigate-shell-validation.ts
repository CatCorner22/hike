export const NAVIGATE_SHELL_MARKER = "hike-navigate-shell-v2";
export const MIN_NAVIGATE_DOCUMENT_BYTES = 512;

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
): boolean {
  if (!looksLikeNavigateHtml(html)) return false;
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
