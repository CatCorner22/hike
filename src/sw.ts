import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { CacheFirst, ExpirationPlugin, NetworkOnly, Serwist } from "serwist";
import {
  headersForRewrittenNavigateDocument,
  isNavigateDocumentRequest,
  isValidNavigateShellDocument,
  NAVIGATE_ASSETS_CACHE,
  NAVIGATE_SHELL_CACHE,
  NAVIGATE_SHELL_MARKER,
  stampNavigateShellHtml,
} from "@/lib/offline/navigate-shell-validation";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: WorkerGlobalScope & { __SW_MANIFEST: (PrecacheEntry | string)[] | undefined };
export { NAVIGATE_ASSETS_CACHE, NAVIGATE_SHELL_CACHE, NAVIGATE_SHELL_MARKER } from "@/lib/offline/navigate-shell-validation";

function offlineDocument(): Response {
  return new Response(
    "<!doctype html><html><head><meta charset=\"utf-8\"><title>Offline navigation</title></head><body><main><h1>Offline navigation is unavailable</h1><p>This navigation screen was not saved before service was lost. Reconnect, then prepare the matching route while you have signal.</p></main></body></html>",
    { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
}

function navigateIdFromRequest(request: Request): string | null {
  try {
    const match = new URL(request.url).pathname.match(/^\/navigate\/([^/]+)\/?$/);
    if (!match) return null;
    const navId = decodeURIComponent(match[1]);
    return navId.length > 0 && navId.length <= 256 ? navId : null;
  } catch {
    return null;
  }
}

async function isValidNavigateDocument(response: Response, navId: string): Promise<boolean> {
  const contentType = response.headers.get("content-type") ?? "";
  const markerHeader = response.headers.get("x-hike-navigate-shell");
  try {
    const document = await response.clone().text();
    return isValidNavigateShellDocument(document, contentType, markerHeader, navId);
  } catch {
    return false;
  }
}

async function markNavigateDocument(response: Response, navId: string): Promise<Response | null> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok || !contentType.toLowerCase().includes("text/html")) return null;
  try {
    const body = await response.clone().text();
    if (!isValidNavigateShellDocument(body, contentType, null, navId)) return null;
    const headers = headersForRewrittenNavigateDocument(response.headers);
    headers.set("x-hike-navigate-shell", NAVIGATE_SHELL_MARKER);
    return new Response(stampNavigateShellHtml(body), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    return null;
  }
}

async function matchNavigateShell(cache: Cache, request: Request): Promise<Response | undefined> {
  const direct =
    (await cache.match(request.url, { ignoreSearch: true, ignoreVary: true })) ??
    (await cache.match(request, { ignoreSearch: true, ignoreVary: true }));
  if (direct) return direct;

  let wanted: URL;
  try {
    wanted = new URL(request.url);
  } catch {
    return undefined;
  }
  if (!wanted.pathname.startsWith("/navigate/")) return undefined;

  for (const key of await cache.keys()) {
    const raw = typeof key === "string" ? key : key.url;
    let keyUrl: URL;
    try {
      keyUrl = new URL(raw);
    } catch {
      continue;
    }
    const samePath =
      keyUrl.pathname === wanted.pathname ||
      keyUrl.pathname === `${wanted.pathname}/` ||
      `${keyUrl.pathname}/` === wanted.pathname;
    if (!samePath) continue;
    const hit = await cache.match(key, { ignoreSearch: true, ignoreVary: true });
    if (hit) return hit;
  }
  return undefined;
}

async function trustedCachedShell(response: Response, navId: string): Promise<Response | null> {
  return (await isValidNavigateDocument(response, navId)) ? response : null;
}

const navigateShellHandler = async ({ request }: { request: Request }) => {
  const navId = navigateIdFromRequest(request);
  if (!navId) return offlineDocument();
  try {
    const cache = await caches.open(NAVIGATE_SHELL_CACHE);
    let networkResponse: Response | null = null;
    try {
      networkResponse = await fetch(request);
      const marked = await markNavigateDocument(networkResponse, navId);
      if (marked) {
        await cache.put(request.url, marked);
        return networkResponse;
      }
    } catch {
      // Cache fallback below. A thrown fetch is expected when the radio is off.
    }

    const cached = await matchNavigateShell(cache, request);
    if (cached) {
      const trusted = await trustedCachedShell(cached, navId);
      if (trusted) return trusted;
    }
    return networkResponse ?? offlineDocument();
  } catch {
    return offlineDocument();
  }
};

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: false,
  fallbacks: {
    entries: [{
      url: "/offline",
      matcher: ({ request }) => {
        if (request.mode !== "navigate") return false;
        try {
          return !new URL(request.url).pathname.startsWith("/navigate/");
        } catch {
          return true;
        }
      },
    }],
  },
  runtimeCaching: [
    {
      matcher: ({ url, request }) => isNavigateDocumentRequest(
        url.pathname,
        request.method,
        request.mode,
      ),
      handler: navigateShellHandler,
    },
    {
      matcher: ({ url }) => url.pathname.startsWith("/_next/static/"),
      handler: new CacheFirst({
        cacheName: NAVIGATE_ASSETS_CACHE,
        plugins: [new ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 })],
      }),
    },
    {
      matcher: ({ url }) => url.pathname.startsWith("/api/"),
      handler: new NetworkOnly(),
    },
    ...defaultCache,
  ],
});

serwist.addEventListeners();
