import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { CacheFirst, ExpirationPlugin, NetworkOnly, Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: WorkerGlobalScope & { __SW_MANIFEST: (PrecacheEntry | string)[] | undefined };

export const NAVIGATE_SHELL_CACHE = "hike-navigate-shell";
export const NAVIGATE_SHELL_MARKER = "hike-navigate-shell-v2";
const MIN_NAVIGATE_DOCUMENT_BYTES = 512;

let getOfflineFallback: () => Promise<Response | undefined> = async () => undefined;

function offlineDocument(): Response {
  return new Response(
    "<!doctype html><html><head><meta charset=\"utf-8\"><title>Offline navigation</title></head><body><main><h1>Offline navigation is unavailable</h1><p>This navigation screen was not saved before service was lost. Reconnect, then prepare the matching route while you have signal.</p></main></body></html>",
    { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
}

function looksLikeNavigateHtml(document: string): boolean {
  return (
    document.length >= MIN_NAVIGATE_DOCUMENT_BYTES &&
    /<!doctype html|<html[\s>]/i.test(document) &&
    /_next\/|self\.__next_f|<body[\s>]/i.test(document)
  );
}

async function isValidNavigateDocument(response: Response): Promise<boolean> {
  const contentType = response.headers.get("content-type") ?? "";
  const markedHeader = response.headers.get("x-hike-navigate-shell") === NAVIGATE_SHELL_MARKER;
  try {
    const document = await response.clone().text();
    const markedBody = document.includes(NAVIGATE_SHELL_MARKER);
    // Chromium Cache Storage can drop custom headers. Accept a Next-shaped
    // document if the header or the in-body marker is present.
    if (!looksLikeNavigateHtml(document)) return false;
    if (contentType && !contentType.toLowerCase().includes("text/html") && !markedHeader && !markedBody) {
      return false;
    }
    return markedHeader || markedBody || looksLikeNavigateHtml(document);
  } catch {
    return false;
  }
}

async function markNavigateDocument(response: Response): Promise<Response | null> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok || !contentType.toLowerCase().includes("text/html")) return null;
  try {
    const body = await response.clone().text();
    if (body.length < MIN_NAVIGATE_DOCUMENT_BYTES || !/<!doctype html|<html[\s>]/i.test(body) || !/_next\/|self\.__next_f|<body[\s>]/i.test(body)) {
      return null;
    }
    const headers = new Headers(response.headers);
    headers.set("x-hike-navigate-shell", NAVIGATE_SHELL_MARKER);
    const stamped = body.includes(NAVIGATE_SHELL_MARKER)
      ? body
      : `<!--${NAVIGATE_SHELL_MARKER}-->${body}`;
    return new Response(stamped, { status: response.status, statusText: response.statusText, headers });
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

const navigateShellHandler = async ({ request }: { request: Request }) => {
  const cache = await caches.open(NAVIGATE_SHELL_CACHE);
  const cached = await matchNavigateShell(cache, request);
  if (cached) {
    if (await isValidNavigateDocument(cached)) return cached;
  }

  try {
    const response = await fetch(request);
    const marked = await markNavigateDocument(response);
    if (marked) await cache.put(request.url, marked);
    return response;
  } catch {
    const fallback = await getOfflineFallback();
    return fallback ?? offlineDocument();
  }
};

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
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
    { matcher: ({ url }) => url.pathname.startsWith("/navigate/"), handler: navigateShellHandler },
    {
      matcher: ({ url }) => url.pathname.startsWith("/_next/static/"),
      handler: new CacheFirst({
        cacheName: "hike-navigate-assets",
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

getOfflineFallback = () => serwist.matchPrecache("/offline");
serwist.addEventListeners();
