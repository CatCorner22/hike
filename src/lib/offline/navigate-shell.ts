import { isOnline } from "@/lib/platform/network";
import { isNative } from "@/lib/platform/native";
import {
  headersForRewrittenNavigateDocument,
  isValidNavigateShellDocument,
  NAVIGATE_ASSETS_CACHE,
  NAVIGATE_SHELL_CACHE,
  NAVIGATE_SHELL_MARKER,
  NAVIGATE_SHELL_ROUTE_ID,
  NAVIGATE_ASSET_MAX_AGE_SECONDS,
  NAVIGATE_WARM_BYPASS_PARAM,
  stampNavigateShellHtml,
} from "@/lib/offline/navigate-shell-validation";

export { NAVIGATE_ASSETS_CACHE, NAVIGATE_SHELL_CACHE, NAVIGATE_SHELL_MARKER } from "@/lib/offline/navigate-shell-validation";

/**
 * One fixed shell document serves every route.
 *
 * With ?target= routing the navigate document is plan-agnostic: the plan id
 * travels in the query string and the route data lives in IndexedDB, so the
 * shell (and its asset manifest) is cached once at a fixed URL instead of once
 * per plan. Per-plan readiness is the route pack in IndexedDB, which callers
 * check separately — this module answers only "can the navigate APP open with
 * no radio". Version 2 keys make every version-1 per-plan entry unreadable, so
 * a device upgraded mid-season honestly reports not-ready until the next
 * Prepare offline instead of trusting a stale per-plan shell.
 */
const NAVIGATE_MANIFEST_VERSION = 2;
const MAX_NAVIGATE_ASSETS = 500;

interface NavigateAssetManifest {
  version: number;
  marker: string;
  routeId: string;
  shellUrl: string;
  assetUrls: string[];
  cachedAt: string;
}

export interface NavigateOfflineStatus {
  shellCached: boolean;
  expectedAssets: number;
  cachedAssets: number;
  missingAssets: string[];
  serviceWorkerControlled: boolean;
  filesReady: boolean;
  ready: boolean;
}

export interface WarmNavigateShellResult extends NavigateOfflineStatus {
  ok: boolean;
  error?: string;
}

const EMPTY_STATUS: NavigateOfflineStatus = {
  shellCached: false,
  expectedAssets: 0,
  cachedAssets: 0,
  missingAssets: [],
  serviceWorkerControlled: false,
  filesReady: false,
  ready: false,
};

function navigateUrl(): URL | null {
  if (typeof window === "undefined") return null;
  return new URL("/navigate", window.location.origin);
}

function nextStaticUrls(html: string, baseUrl: URL): URL[] {
  const urls = new Set<string>();
  const attributePattern = /<(?:script|link)\b[^>]+?(?:src|href)=["']([^"']+)["']/gi;
  for (const match of html.matchAll(attributePattern)) {
    try {
      const url = new URL(match[1], baseUrl);
      if (url.origin === baseUrl.origin && url.pathname.startsWith("/_next/static/")) urls.add(url.toString());
    } catch {
      // A malformed resource reference makes that reference unusable, but does
      // not prevent us from validating the other explicit assets.
    }
  }
  return [...urls].map((url) => new URL(url));
}

function ownMarkedDocument(response: Response, html: string): Response | null {
  const contentType = response.headers.get("content-type") ?? "";
  if (!isValidNavigateShellDocument(html, contentType, null, NAVIGATE_SHELL_ROUTE_ID)) return null;
  const headers = headersForRewrittenNavigateDocument(response.headers);
  headers.set("x-hike-navigate-shell", NAVIGATE_SHELL_MARKER);
  return new Response(stampNavigateShellHtml(html), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function manifestUrl(): URL | null {
  if (typeof window === "undefined") return null;
  return new URL("/__klandagi__/navigate-manifest/shell", window.location.origin);
}

function validManifest(value: unknown, origin: string): value is NavigateAssetManifest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as NavigateAssetManifest;
  if (
    candidate.version !== NAVIGATE_MANIFEST_VERSION ||
    candidate.marker !== NAVIGATE_SHELL_MARKER ||
    candidate.routeId !== NAVIGATE_SHELL_ROUTE_ID ||
    typeof candidate.shellUrl !== "string" ||
    !Array.isArray(candidate.assetUrls) ||
    candidate.assetUrls.length < 1 ||
    candidate.assetUrls.length > MAX_NAVIGATE_ASSETS ||
    new Set(candidate.assetUrls).size !== candidate.assetUrls.length ||
    !Number.isFinite(Date.parse(candidate.cachedAt))
  ) return false;
  try {
    const shell = new URL(candidate.shellUrl);
    if (shell.origin !== origin || shell.pathname !== "/navigate") return false;
    return candidate.assetUrls.every((raw) => {
      const asset = new URL(raw);
      return asset.origin === origin && asset.pathname.startsWith("/_next/static/");
    });
  } catch {
    return false;
  }
}

async function readCachedShell(): Promise<boolean> {
  const url = navigateUrl();
  if (!url || typeof caches === "undefined") return false;
  const cache = await caches.open(NAVIGATE_SHELL_CACHE);
  const response = await cache.match(url.toString(), { ignoreSearch: true, ignoreVary: true });
  if (!response) return false;
  if (response.headers.get("x-hike-navigate-shell") === NAVIGATE_SHELL_MARKER) return true;
  try {
    const html = await response.clone().text();
    // requireMarker: deciding whether to TRUST what is already cached.
    return isValidNavigateShellDocument(
      html,
      response.headers.get("content-type") ?? "",
      response.headers.get("x-hike-navigate-shell"),
      NAVIGATE_SHELL_ROUTE_ID,
      true,
    );
  } catch {
    return false;
  }
}

/**
 * Drop version-1 per-plan entries (`/navigate/<id>`, per-plan manifests) so the
 * shell cache cannot grow one dead document per plan forever. Best-effort.
 */
async function pruneLegacyShellEntries(shellCache: Cache, keep: Set<string>): Promise<void> {
  try {
    for (const key of await shellCache.keys()) {
      const raw = typeof key === "string" ? key : key.url;
      if (!keep.has(raw)) await shellCache.delete(key);
    }
  } catch {
    // Pruning is hygiene, not readiness: a failure here must never fail a warm.
  }
}

/**
 * Inside the native shell every app asset ships in the bundle itself — there is
 * no service worker and nothing to warm, and reporting "not ready" here would
 * permanently lock the readiness gate on the platform where offline launch is
 * guaranteed by construction.
 */
const NATIVE_BUNDLED_STATUS: NavigateOfflineStatus = {
  shellCached: true,
  expectedAssets: 1,
  cachedAssets: 1,
  missingAssets: [],
  serviceWorkerControlled: true,
  filesReady: true,
  ready: true,
};

/** Warm only an app-shaped, explicitly marked navigation document. */
export async function warmNavigateShell(): Promise<WarmNavigateShellResult> {
  if (isNative()) return { ...NATIVE_BUNDLED_STATUS, ok: true };
  const first = await warmNavigateShellOnce();
  if (first.ok) return first;
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  return warmNavigateShellOnce();
}

async function warmNavigateShellOnce(): Promise<WarmNavigateShellResult> {
  const url = navigateUrl();
  const fail = (error: string, status: Partial<NavigateOfflineStatus> = {}): WarmNavigateShellResult => ({
    ...EMPTY_STATUS,
    ...status,
    ok: false,
    error,
  });
  if (!url || typeof caches === "undefined") return fail("Offline cache is unavailable in this browser.");
  if (!isOnline()) return fail("Reconnect to cache the navigation screen.");
  try {
    const response = await fetch(url.toString(), { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) return fail(`Navigation screen could not be cached (${response.status}).`);
    const html = await response.clone().text();
    const marked = ownMarkedDocument(response, html);
    if (!marked) return fail("Navigation screen response did not prove that it was the navigate app shell.");
    const assets = nextStaticUrls(html, url);
    if (assets.length < 1) return fail("Navigation screen listed no versioned app files, so offline readiness cannot be verified.");
    if (assets.length > MAX_NAVIGATE_ASSETS) return fail("Navigation screen listed too many app files to verify safely.");
    const shellCache = await caches.open(NAVIGATE_SHELL_CACHE);
    const assetCache = await caches.open(NAVIGATE_ASSETS_CACHE);
    const missingAssets: string[] = [];
    await Promise.all(assets.map(async (assetUrl) => {
      try {
        // Fetch through the service worker's warm bypass so the response (and
        // its Date header, which drives the 30-day readiness window) comes
        // from the network, not from the cache this warm is refreshing. The
        // entry is stored under the clean URL the app will actually request.
        const fetchUrl = new URL(assetUrl.toString());
        fetchUrl.searchParams.set(NAVIGATE_WARM_BYPASS_PARAM, "1");
        const asset = await fetch(fetchUrl.toString(), { cache: "no-store", credentials: "same-origin" });
        if (!asset.ok) throw new Error(String(asset.status));
        await assetCache.put(assetUrl.toString(), asset);
      } catch {
        missingAssets.push(assetUrl.toString());
      }
    }));
    if (missingAssets.length) {
      return fail(
        `${missingAssets.length} required app file${missingAssets.length === 1 ? " is" : "s are"} missing. Retry on a stable connection.`,
        { expectedAssets: assets.length, cachedAssets: assets.length - missingAssets.length, missingAssets },
      );
    }
    await shellCache.put(url.toString(), marked);
    const manifestKey = manifestUrl();
    if (!manifestKey) return fail("Navigation manifest could not be created.");
    const manifest: NavigateAssetManifest = {
      version: NAVIGATE_MANIFEST_VERSION,
      marker: NAVIGATE_SHELL_MARKER,
      routeId: NAVIGATE_SHELL_ROUTE_ID,
      shellUrl: url.toString(),
      assetUrls: assets.map((asset) => asset.toString()),
      cachedAt: new Date().toISOString(),
    };
    await shellCache.put(manifestKey.toString(), new Response(JSON.stringify(manifest), {
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    }));
    await pruneLegacyShellEntries(shellCache, new Set([url.toString(), manifestKey.toString()]));

    // Slow browsers can expose Cache Storage writes a few ticks later.
    for (let attempt = 0; attempt < 15; attempt += 1) {
      const status = await getNavigateOfflineStatus();
      if (status.ready) return { ...status, ok: true };
      if (status.filesReady && !status.serviceWorkerControlled) {
        return fail(
          "Files are saved, but this page is not controlled by the service worker yet. Close and reopen the installed app, then verify again.",
          status,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const status = await getNavigateOfflineStatus();
    return fail("Navigation files were written but failed complete verification.", status);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Navigation screen could not be cached.");
  }
}

export async function isNavigateShellCached(): Promise<boolean> {
  return (await getNavigateOfflineStatus()).filesReady;
}

export async function getNavigateOfflineStatus(): Promise<NavigateOfflineStatus> {
  if (isNative()) return { ...NATIVE_BUNDLED_STATUS };
  const shellUrl = navigateUrl();
  const manifestKey = manifestUrl();
  if (!shellUrl || !manifestKey || typeof caches === "undefined") return EMPTY_STATUS;
  const shellCached = await readCachedShell();
  let manifest: NavigateAssetManifest | null = null;
  try {
    const shellCache = await caches.open(NAVIGATE_SHELL_CACHE);
    const response = await shellCache.match(manifestKey.toString(), { ignoreVary: true });
    const parsed = response ? await response.json() : null;
    if (validManifest(parsed, shellUrl.origin)) manifest = parsed;
  } catch {
    manifest = null;
  }
  const missingAssets: string[] = [];
  if (manifest) {
    const assetCache = await caches.open(NAVIGATE_ASSETS_CACHE);
    const oldestUsable = Date.now() - NAVIGATE_ASSET_MAX_AGE_SECONDS * 1000;
    for (const assetUrl of manifest.assetUrls) {
      const hit = await assetCache.match(assetUrl, { ignoreVary: true });
      if (!hit || !hit.ok) {
        missingAssets.push(assetUrl);
        continue;
      }
      // An asset the worker will refuse to serve is not cached in any sense
      // that matters. Readiness applied no age rule at all, so a route
      // prepared five weeks ago reported trip-ready right up until the moment
      // it was needed offline — and never corrected itself.
      const dateHeader = hit.headers.get("date");
      const cachedAtMs = dateHeader ? Date.parse(dateHeader) : Number.NaN;
      if (Number.isFinite(cachedAtMs) && cachedAtMs < oldestUsable) missingAssets.push(assetUrl);
    }
  }
  const expectedAssets = manifest?.assetUrls.length ?? 0;
  const cachedAssets = Math.max(0, expectedAssets - missingAssets.length);
  const serviceWorkerControlled = Boolean(
    typeof navigator !== "undefined" && navigator.serviceWorker?.controller,
  );
  const filesReady = shellCached && expectedAssets > 0 && missingAssets.length === 0;
  return {
    shellCached,
    expectedAssets,
    cachedAssets,
    missingAssets,
    serviceWorkerControlled,
    filesReady,
    ready: filesReady && serviceWorkerControlled,
  };
}
