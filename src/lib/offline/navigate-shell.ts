export const NAVIGATE_SHELL_CACHE = "hike-navigate-shell";
export const NAVIGATE_SHELL_MARKER = "hike-navigate-shell-v2";

export interface WarmNavigateShellResult { ok: boolean; cachedAssets: number; error?: string; }

function navigateUrl(navId: string): URL | null {
  if (typeof window === "undefined") return null;
  return new URL(`/navigate/${encodeURIComponent(navId)}`, window.location.origin);
}

function nextStaticUrls(html: string, baseUrl: URL): URL[] {
  const urls = new Set<string>();
  const attributePattern = /<(?:script|link)\b[^>]+?(?:src|href)=["']([^"']+)["']/gi;
  for (const match of html.matchAll(attributePattern)) {
    const url = new URL(match[1], baseUrl);
    if (url.origin === baseUrl.origin && url.pathname.startsWith("/_next/static/")) urls.add(url.toString());
  }
  return [...urls].map((url) => new URL(url));
}

function ownMarkedDocument(response: Response, html: string): Response | null {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("text/html") || html.length < 512 ||
    !/<!doctype html|<html[\s>]/i.test(html) || !/_next\/|self\.__next_f|<body[\s>]/i.test(html)) return null;
  const headers = new Headers(response.headers);
  headers.set("x-hike-navigate-shell", NAVIGATE_SHELL_MARKER);
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
}

/** Warm only an app-shaped, explicitly marked navigation document. */
export async function warmNavigateShell(navId: string): Promise<WarmNavigateShellResult> {
  const url = navigateUrl(navId);
  if (!url || typeof caches === "undefined") return { ok: false, cachedAssets: 0, error: "Offline cache is unavailable in this browser." };
  if (!navigator.onLine) return { ok: false, cachedAssets: 0, error: "Reconnect to cache the navigation screen." };
  try {
    const response = await fetch(url.toString(), { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) return { ok: false, cachedAssets: 0, error: `Navigation screen could not be cached (${response.status}).` };
    const html = await response.clone().text();
    const marked = ownMarkedDocument(response, html);
    if (!marked) return { ok: false, cachedAssets: 0, error: "Navigation screen response failed its integrity check." };
    const cache = await caches.open(NAVIGATE_SHELL_CACHE);
    await cache.put(url.toString(), marked);
    let cachedAssets = 0;
    await Promise.all(nextStaticUrls(html, url).map(async (assetUrl) => {
      try {
        const asset = await fetch(assetUrl.toString(), { cache: "no-store", credentials: "same-origin" });
        if (asset.ok) { await cache.put(assetUrl.toString(), asset); cachedAssets += 1; }
      } catch { /* precache may still provide this asset */ }
    }));
    return { ok: true, cachedAssets };
  } catch (error) {
    return { ok: false, cachedAssets: 0, error: error instanceof Error ? error.message : "Navigation screen could not be cached." };
  }
}

export async function isNavigateShellCached(navId: string): Promise<boolean> {
  const url = navigateUrl(navId);
  if (!url || typeof caches === "undefined") return false;
  const cache = await caches.open(NAVIGATE_SHELL_CACHE);
  const response = await cache.match(url.toString(), { ignoreVary: true });
  return response?.headers.get("x-hike-navigate-shell") === NAVIGATE_SHELL_MARKER &&
    Boolean(response.headers.get("content-type")?.toLowerCase().includes("text/html"));
}
