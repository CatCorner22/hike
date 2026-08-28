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
  NAVIGATE_SHELL_ROUTE_ID,
  NAVIGATE_ASSET_MAX_AGE_SECONDS,
  MAX_NAVIGATE_ASSETS,
  NAVIGATE_WARM_BYPASS_PARAM,
  stampNavigateShellHtml,
} from "@/lib/offline/navigate-shell-validation";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: WorkerGlobalScope & { __SW_MANIFEST: (PrecacheEntry | string)[] | undefined };
export { NAVIGATE_ASSETS_CACHE, NAVIGATE_SHELL_CACHE, NAVIGATE_SHELL_MARKER } from "@/lib/offline/navigate-shell-validation";

function offlineDocument(misses: string[] = []): Response {
  // The miss trail is diagnostic gold when this page appears wrongly: it says whether
  // each cache attempt missed, failed validation, errored, or timed out. Machine- and
  // human-readable via a data attribute; invisible to the hiker.
  const trail = misses.join("|").slice(0, 400).replace(/[^a-zA-Z0-9|>:_-]/g, "");
  // /offline and /saved are precached with per-build revisions, so they remain
  // reachable even here: a hiker whose shell was evicted but whose route packs
  // survived deserves a path to them, not a dead end.
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>Offline navigation</title></head><body data-shell-miss="${trail}"><main><h1>Offline navigation is unavailable</h1><p>This navigation screen was not saved before service was lost. Reconnect, then prepare the matching route while you have signal.</p><p><a href="/saved">Open routes saved on this device</a> · <a href="/offline">Offline home</a></p></main></body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
}

/**
 * The plan identity travels in ?target= now — one fixed shell document serves
 * every plan, so the target is diagnostic context only. Validation checks the
 * constant shell marker, never the target.
 */
function navigateTargetFromRequest(request: Request): string | null {
  try {
    const target = new URL(request.url).searchParams.get("target");
    return target && target.length > 0 && target.length <= 256 ? target : null;
  } catch {
    return null;
  }
}

async function isValidNavigateDocument(response: Response): Promise<boolean> {
  const contentType = response.headers.get("content-type") ?? "";
  const markerHeader = response.headers.get("x-hike-navigate-shell");
  try {
    const document = await response.clone().text();
    // requireMarker: this is the cached-trust path, so a document without the
    // current marker version must not be served.
    return isValidNavigateShellDocument(document, contentType, markerHeader, NAVIGATE_SHELL_ROUTE_ID, true);
  } catch {
    return false;
  }
}

async function markNavigateDocument(response: Response): Promise<Response | null> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok || !contentType.toLowerCase().includes("text/html")) return null;
  try {
    const body = await response.clone().text();
    if (!isValidNavigateShellDocument(body, contentType, null, NAVIGATE_SHELL_ROUTE_ID)) return null;
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
  if (wanted.pathname !== "/navigate" && wanted.pathname !== "/navigate/") return undefined;

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

async function trustedCachedShell(response: Response): Promise<Response | null> {
  return (await isValidNavigateDocument(response)) ? response : null;
}

/**
 * The cold-start read gets a generous bound: on a slow phone (or a loaded CI runner)
 * `caches.open` plus a full-body read and validation can take well over half a second,
 * and a timeout here serves the "not saved before service was lost" dead end DESPITE a
 * valid prepared shell sitting in the cache — the exact failure this screen exists to
 * prevent. A hiker would rather wait a few seconds and navigate. The retry reads stay
 * short: they only exist to catch Cache Storage waking up, and the total budget must
 * keep the screen from hanging forever.
 */
const COLD_START_READ_TIMEOUT_MS = 4_000;
const CACHE_RETRY_READ_TIMEOUT_MS = 750;
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

const READ_TIMED_OUT = Symbol("read-timed-out");

async function readTrustedCachedShell(
  request: Request,
  timeoutMs: number,
  misses?: string[],
): Promise<Response | null> {
  const result = await resolveWithin<Response | null | typeof READ_TIMED_OUT>(
    (async () => {
      try {
        const cache = await caches.open(NAVIGATE_SHELL_CACHE);
        const cached = await matchNavigateShell(cache, request);
        if (!cached) {
          misses?.push("miss");
          return null;
        }
        const trusted = await trustedCachedShell(cached);
        if (!trusted) misses?.push("invalid");
        return trusted;
      } catch {
        // Cache Storage can be briefly unavailable while a worker wakes or the
        // browser switches network state. Callers decide whether to retry.
        misses?.push("error");
        return null;
      }
    })(),
    timeoutMs,
    READ_TIMED_OUT,
  );
  if (result === READ_TIMED_OUT) {
    misses?.push(`timeout>${timeoutMs}ms`);
    return null;
  }
  return result;
}

async function retryTrustedCachedShell(
  request: Request,
  misses?: string[],
): Promise<Response | null> {
  // A prepared shell is life-safety data and has already passed validation.
  // Give Cache Storage a bounded chance to become visible again after a
  // failed network fetch instead of immediately making a false missing claim.
  for (const delayMs of [0, 100, 300, 700]) {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const cached = await readTrustedCachedShell(request, CACHE_RETRY_READ_TIMEOUT_MS, misses);
    if (cached) return cached;
  }
  return null;
}

type NetworkNavigateDocument = {
  response: Response;
  trusted: boolean;
};

/**
 * The shell document is plan-agnostic, so store it under the bare path. Keying
 * by the full URL grew one duplicate HTML copy per `?target=` visited online
 * (reads already use `ignoreSearch`), pruned only when the user next prepared.
 */
function navigateShellCacheKey(requestUrl: string): string {
  try {
    const url = new URL(requestUrl);
    url.search = "";
    return url.toString();
  } catch {
    return requestUrl;
  }
}

async function persistNavigateDocument(request: Request, marked: Response): Promise<void> {
  await resolveWithin(
    (async () => {
      try {
        const cache = await caches.open(NAVIGATE_SHELL_CACHE);
        await cache.put(navigateShellCacheKey(request.url), marked);
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
): Promise<NetworkNavigateDocument | null> {
  const controller = new AbortController();
  const attempt = (async (): Promise<{
    response: Response;
    marked: Response | null;
  } | null> => {
    try {
      const response = await fetch(request, { signal: controller.signal });
      const marked = await markNavigateDocument(response);
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

/**
 * Every navigate-document decision is recorded into a small diagnostic cache the app
 * (and the e2e probe) can read back. The cold-offline path has failed on CI with the
 * page showing content this handler never serves — the record answers, from inside the
 * worker, whether the handler even ran for a given navigation, what each cache attempt
 * returned, and how long it took. Fire-and-forget; never blocks the response.
 */
const NAV_DIAG_CACHE = "klandagi-nav-diag";

function recordNavigateDecision(entry: Record<string, unknown>): void {
  void (async () => {
    try {
      const cache = await caches.open(NAV_DIAG_CACHE);
      await cache.put(
        "/__klandagi__/nav-diag/last",
        new Response(JSON.stringify(entry), { headers: { "content-type": "application/json" } }),
      );
    } catch {
      /* diagnostics must never break navigation */
    }
  })();
}

const navigateShellHandler = async ({ request }: { request: Request }) => {
  const startedAt = Date.now();
  // Diagnostic context only: the shell document is plan-agnostic, so a missing
  // target must not block serving it — the page itself redirects when unset.
  const navId = navigateTargetFromRequest(request) ?? "none";
  const misses: string[] = [];
  const done = (outcome: string, response: Response): Response => {
    recordNavigateDecision({
      url: request.url,
      navId,
      outcome,
      misses,
      durationMs: Date.now() - startedAt,
      at: new Date(startedAt).toISOString(),
    });
    return response;
  };
  // An explicit no-store/reload request is preparation asking for a FRESH
  // shell, not a launch. Serving it from cache made the cached shell
  // permanently unrepairable: every later deploy — including safety fixes —
  // was invisible to a device that had already prepared once. Try the network
  // first for those, and fall through to the cache when it fails.
  const revalidating = request.cache === "no-store" || request.cache === "reload";
  if (revalidating) {
    const fresh = await fetchNavigateDocument(request);
    if (fresh?.trusted) return done("shell-revalidated", fresh.response);
    misses.push("revalidate-failed");
  }

  // A prepared shell has already been validated and is the only launch path
  // that does not depend on the radio. Prefer it before touching the network:
  // a fetch can remain pending indefinitely under degraded connectivity
  // instead of throwing an offline error.
  const prepared = await readTrustedCachedShell(request, COLD_START_READ_TIMEOUT_MS, misses);
  if (prepared) return done("shell-cold", prepared);

  // Retry Cache Storage while the network is attempted. Neither source is
  // allowed to hold navigation open forever: a degraded radio can leave fetch
  // pending, and Cache Storage can briefly stall while a worker wakes.
  const recovered = retryTrustedCachedShell(request, misses);
  const network = fetchNavigateDocument(request);
  const usable = await firstNonNull<Response>([
    recovered,
    network.then((result) => (result?.trusted ? result.response : null)),
  ]);
  if (usable) return done("shell-retry-or-network", usable);

  const attempted = await network;
  if (attempted?.response) return done("network-untrusted", attempted.response);
  misses.push("network-failed");
  return done("offline-fallback", offlineDocument(misses));
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
          const pathname = new URL(request.url).pathname;
          return pathname !== "/navigate" && pathname !== "/navigate/";
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
      // The shell warmer's refresh fetches. They must reach the network — a
      // CacheFirst answer here would hand the warm back the very entry it is
      // trying to refresh, `Date` header and all, so re-preparing could never
      // reset the 30-day asset clock.
      matcher: ({ url }) =>
        url.pathname.startsWith("/_next/static/") && url.searchParams.has(NAVIGATE_WARM_BYPASS_PARAM),
      handler: new NetworkOnly(),
    },
    {
      matcher: ({ url }) => url.pathname.startsWith("/_next/static/"),
      handler: new CacheFirst({
        cacheName: NAVIGATE_ASSETS_CACHE,
        plugins: [
          new ExpirationPlugin({ maxEntries: MAX_NAVIGATE_ASSETS, maxAgeSeconds: NAVIGATE_ASSET_MAX_AGE_SECONDS }),
        ],
      }),
    },
    {
      matcher: ({ url }) => url.pathname.startsWith("/api/"),
      handler: new NetworkOnly(),
    },
    {
      // Forecast snapshots must not land in defaultCache's cross-origin
      // NetworkFirst: a failed re-prepare would replay a ≤1h-old body and
      // buildHazardBrief would stamp generatedAt = now on stale model data.
      matcher: ({ url }) => url.hostname === "api.open-meteo.com",
      handler: new NetworkOnly(),
    },
    ...defaultCache,
  ],
});

serwist.addEventListeners();
