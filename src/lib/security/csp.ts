/**
 * One CSP string for the web headers() path and the capacitor <meta> tag.
 * Static export cannot send headers; WKWebView still honors http-equiv.
 */
export function contentSecurityPolicy(extraConnectOrigins: string[] = []): string {
  const connectSrc = [
    "'self'",
    "https://api.maptiler.com",
    "https://*.maptiler.com",
    "https://tiles.openfreemap.org",
    "https://*.openfreemap.org",
    "https://api.open-meteo.com",
    ...extraConnectOrigins.filter((origin) => /^https:\/\//.test(origin)),
  ].join(" ");
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.maptiler.com https://*.openfreemap.org",
    `connect-src ${connectSrc}`,
    "worker-src 'self' blob:",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function httpsOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}
