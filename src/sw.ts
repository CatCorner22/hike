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

const CACHE_READ_TIMEOUT_MS = 500;
const CACHE_WRITE_TIMEOUT_MS = 500;
const NETWORK_TIMEOUT_MS = 5_000;

async function resolveWithin<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function readTrustedCachedShell(request: Request, navId: string): Promise<Response | null> {
  return resolveWithin(
    (async () => {
      try {
        const cache = await caches.open(NAVIGATE_SHELL_CACHE);
        const cached = await matchNavigateShell(cache, request);
        return cached ? trustedCachedShell(cached, navId) : null;
      } catch {
        // Cache Storage can be briefly unavailable while a worker wakes or the
        // browser switches network state. Callers decide whether to retry.
        return null;
      }
    })(),
    CACHE_READ_TIMEOUT_MS,
    null,
  );
}

async function retryTrustedCachedShell(request: Request, navId: string): Promise<Response | null> {
  // A prepared shell is life-safety data and has already passed validation.
  // Give Cache Storage a short bounded chance to become visible again after a
  // failed network fetch instead of immediately making a false missing claim.
  for (const delayMs of [0, 25, 75, 150]) {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const cached = await readTrustedCachedShell(request, navId);
    if (cached) return cached;
  }
  return null;
}

type NetworkNavigateDocument = {
  response: Response;
  trusted: boolean;
};

async function persistNavigateDocument(request: Request, marked: Response): Promise<void> {
  await resolveWithin(
    (async () => {
      try {
        const cache = await caches.open(NAVIGATE_SHELL_CACHE);
        await cache.put(request.url, marked);
      } catch {
        /* the live response remains usable, but was not durably prepared */
      }
    })(),
    CACHE_WRITE_TIMEOUT_MS,
    undefined,
  );
}

async function fetchNavigateDocument(
  request: Request,
  navId: string,
): Promise<NetworkNavigateDocument | null> {
  const controller = new AbortController();
  const attempt = (async (): Promise<{
    response: Response;
    marked: Response | null;
  } | null> => {
    try {
      const response = await fetch(request, { signal: controller.signal });
      const marked = await markNavigateDocument(response, navId);
      return { response, marked };
    } catch {
      return null;
    }
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, NETWORK_TIMEOUT_MS);
  });
  try {
    // Do not abort after a successful fetch: the original response body is the
    // one returned to the browser, and aborting its signal can poison that body.
    const fetched = await Promise.race([attempt, timeout]);
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (!fetched) return null;
    // Persistence has its own bound. A slow/full cache must never discard a
    // live document that completed validation before the network deadline.
    if (fetched.marked) await persistNavigateDocument(request, fetched.marked);
    return { response: fetched.response, trusted: fetched.marked !== null };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function firstNonNull<T>(attempts: Array<Promise<T | null>>): Promise<T | null> {
  return new Promise((resolve) => {
    let remaining = attempts.length;
    let resolved = false;
    const consider = (value: T | null) => {
      if (resolved) return;
      if (value !== null) {
        resolved = true;
        resolve(value);
        return;
      }
      remaining -= 1;
      if (remaining === 0) {
        resolved = true;
        resolve(null);
      }
    };
    for (const attempt of attempts) attempt.then(consider, () => consider(null));
  });
}

const navigateShellHandler = async ({ request }: { request: Request }) => {
  const navId = navigateIdFromRequest(request);
  if (!navId) return offlineDocument();
  // A prepared shell has already been validated for this exact route and is
  // the only launch path that does not depend on the radio. Prefer it before
  // touching the network: a fetch can remain pending indefinitely under
  // degraded connectivity instead of throwing an offline error.
  const prepared = await readTrustedCachedShell(request, navId);
  if (prepared) return prepared;

  // Retry Cache Storage while the network is attempted. Neither source is
  // allowed to hold navigation open forever: a degraded radio can leave fetch
  // pending, and Cache Storage can briefly stall while a worker wakes.
  const recovered = retryTrustedCachedShell(request, navId);
  const network = fetchNavigateDocument(request, navId);
  const usable = await firstNonNull<Response>([
    recovered,
    network.then((result) => (result?.trusted ? result.response : null)),
  ]);
  if (usable) return usable;

  const attempted = await network;
  return attempted?.response ?? offlineDocument();
};

export { navigateShellHandler };

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
        request.headers.get("RSC"),
        request.headers.get("Next-Router-Prefetch"),
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
