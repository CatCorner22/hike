import {
  isValidNavigateShellDocument,
  NAVIGATE_SHELL_MARKER,
  stampNavigateShellHtml,
} from "@/lib/offline/navigate-shell-validation";

export const NAVIGATE_SHELL_CACHE = "hike-navigate-shell";
export { NAVIGATE_SHELL_MARKER } from "@/lib/offline/navigate-shell-validation";

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
  if (!isValidNavigateShellDocument(html, contentType, null)) return null;
  const headers = new Headers(response.headers);
  headers.set("x-hike-navigate-shell", NAVIGATE_SHELL_MARKER);
  return new Response(stampNavigateShellHtml(html), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function readCachedShell(navId: string): Promise<boolean> {
  const url = navigateUrl(navId);
  if (!url || typeof caches === "undefined") return false;
  const cache = await caches.open(NAVIGATE_SHELL_CACHE);
  const response = await cache.match(url.toString(), { ignoreSearch: true, ignoreVary: true });
  if (!response) return false;
  if (response.headers.get("x-hike-navigate-shell") === NAVIGATE_SHELL_MARKER) return true;
  try {
    const html = await response.clone().text();
    return isValidNavigateShellDocument(
      html,
      response.headers.get("content-type") ?? "",
      response.headers.get("x-hike-navigate-shell"),
    );
  } catch {
    return false;
  }
}

/** Warm only an app-shaped, explicitly marked navigation document. */
export async function warmNavigateShell(navId: string): Promise<WarmNavigateShellResult> {
  const first = await warmNavigateShellOnce(navId);
  if (first.ok) return first;
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  return warmNavigateShellOnce(navId);
}

async function warmNavigateShellOnce(navId: string): Promise<WarmNavigateShellResult> {
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
    // Slow CI runners can read Cache Storage before the put is visible to the SW.
    for (let attempt = 0; attempt < 15; attempt += 1) {
      if (await readCachedShell(navId)) return { ok: true, cachedAssets };
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return { ok: false, cachedAssets, error: "Navigation screen was written but failed verification." };
  } catch (error) {
    return { ok: false, cachedAssets: 0, error: error instanceof Error ? error.message : "Navigation screen could not be cached." };
  }
}

export async function isNavigateShellCached(navId: string): Promise<boolean> {
  return readCachedShell(navId);
}
