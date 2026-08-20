import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { CacheFirst, ExpirationPlugin, NetworkFirst, Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: WorkerGlobalScope & {
  __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
};

const NAVIGATE_SHELL_CACHE = "hike-navigate-shell";

let getOfflineFallback: () => Promise<Response | undefined> = async () => undefined;

/**
 * Cache API warming happens from a normal page fetch, while a browser
 * navigation has a different request mode and Next adds Vary headers for its
 * RSC internals. Match the exact URL while intentionally ignoring Vary, so
 * the shell saved at prepare time is the shell returned to a cold navigation.
 */
const navigateShellHandler = async ({ request }: { request: Request }) => {
  const cache = await caches.open(NAVIGATE_SHELL_CACHE);
  const cached = await cache.match(request.url, {
    ignoreSearch: false,
    ignoreVary: true,
  });
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request.url, response.clone());
    }
    return response;
  } catch (error) {
    // The fallbacks configuration below precaches this route. Explicitly
    // return it here because this handler needs Cache.match(...ignoreVary).
    const fallback = await getOfflineFallback();
    if (fallback) return fallback;
    throw error;
  }
};

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  fallbacks: {
    entries: [
      {
        url: "/offline",
        matcher: ({ request }) => request.mode === "navigate",
      },
    ],
  },
  runtimeCaching: [
    {
      matcher: ({ url }) => url.pathname.startsWith("/navigate/"),
      handler: navigateShellHandler,
    },
    {
      // Warmed chunks share the document cache so a missing Serwist precache
      // entry cannot prevent an otherwise cached navigation screen from booting.
      matcher: ({ url }) => url.pathname.startsWith("/_next/static/"),
      handler: new CacheFirst({
        cacheName: NAVIGATE_SHELL_CACHE,
        plugins: [
          new ExpirationPlugin({
            maxEntries: 300,
            maxAgeSeconds: 60 * 60 * 24 * 30,
          }),
        ],
      }),
    },
    {
      // Mutable plans use the explicit IndexedDB route-pack path, not runtime HTTP caching.
      matcher: ({ url }) => url.pathname.startsWith("/api/trails/"),
      handler: new NetworkFirst({
        cacheName: "hike-route-api",
        networkTimeoutSeconds: 3,
        plugins: [
          new ExpirationPlugin({
            maxEntries: 50,
            maxAgeSeconds: 60 * 60 * 24 * 14,
          }),
        ],
      }),
    },
    ...defaultCache,
  ],
});

getOfflineFallback = () => serwist.matchPrecache("/offline");

serwist.addEventListeners();
