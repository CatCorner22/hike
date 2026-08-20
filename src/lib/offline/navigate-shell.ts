export const NAVIGATE_SHELL_CACHE = "hike-navigate-shell";

export interface WarmNavigateShellResult {
  ok: boolean;
  cachedAssets: number;
  error?: string;
}

function navigateUrl(navId: string): URL | null {
  if (typeof window === "undefined") return null;
  return new URL(`/navigate/${encodeURIComponent(navId)}`, window.location.origin);
}

function nextStaticUrls(html: string, baseUrl: URL): URL[] {
  const urls = new Set<string>();
  const attributePattern = /<(?:script|link)\b[^>]+?(?:src|href)=["']([^"']+)["']/gi;
  for (const match of html.matchAll(attributePattern)) {
    const url = new URL(match[1], baseUrl);
    if (url.origin === baseUrl.origin && url.pathname.startsWith("/_next/static/")) {
      urls.add(url.toString());
    }
  }
  return [...urls].map((url) => new URL(url));
}

/**
 * Stores the exact document URL that the service worker serves for
 * /navigate/:id. The service worker deliberately uses ignoreVary when
 * matching this cache: Next navigation responses vary on internal RSC
 * headers, while Cache API warming is an ordinary page fetch.
 */
export async function warmNavigateShell(navId: string): Promise<WarmNavigateShellResult> {
  const url = navigateUrl(navId);
  if (!url || typeof caches === "undefined") {
    return { ok: false, cachedAssets: 0, error: "Offline cache is unavailable in this browser." };
  }
  if (!navigator.onLine) {
    return { ok: false, cachedAssets: 0, error: "Reconnect to cache the navigation screen." };
  }

  try {
    const response = await fetch(url.toString(), {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) {
      return {
        ok: false,
        cachedAssets: 0,
        error: `Navigation screen could not be cached (${response.status}).`,
      };
    }

    const cache = await caches.open(NAVIGATE_SHELL_CACHE);
    const html = await response.clone().text();
    await cache.put(url.toString(), response);

    let cachedAssets = 0;
    await Promise.all(
      nextStaticUrls(html, url).map(async (assetUrl) => {
        try {
          const asset = await fetch(assetUrl.toString(), {
            cache: "no-store",
            credentials: "same-origin",
          });
          if (asset.ok) {
            await cache.put(assetUrl.toString(), asset);
            cachedAssets += 1;
          }
        } catch {
          // A precached asset may still be available; shell warming is best-effort.
        }
      }),
    );
    return { ok: true, cachedAssets };
  } catch (error) {
    return {
      ok: false,
      cachedAssets: 0,
      error: error instanceof Error ? error.message : "Navigation screen could not be cached.",
    };
  }
}

export async function isNavigateShellCached(navId: string): Promise<boolean> {
  const url = navigateUrl(navId);
  if (!url || typeof caches === "undefined") return false;
  const cache = await caches.open(NAVIGATE_SHELL_CACHE);
  return Boolean(await cache.match(url.toString(), { ignoreVary: true }));
}
