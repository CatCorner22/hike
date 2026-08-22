import {
  isValidNavigateShellDocument,
  NAVIGATE_ASSETS_CACHE,
  NAVIGATE_SHELL_CACHE,
  NAVIGATE_SHELL_MARKER,
  stampNavigateShellHtml,
} from "@/lib/offline/navigate-shell-validation";

export { NAVIGATE_ASSETS_CACHE, NAVIGATE_SHELL_CACHE, NAVIGATE_SHELL_MARKER } from "@/lib/offline/navigate-shell-validation";

const NAVIGATE_MANIFEST_VERSION = 1;
const MAX_NAVIGATE_ASSETS = 500;

interface NavigateAssetManifest {
  version: number;
  marker: string;
  navId: string;
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

function navigateUrl(navId: string): URL | null {
  if (typeof window === "undefined") return null;
  return new URL(`/navigate/${encodeURIComponent(navId)}`, window.location.origin);
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

function ownMarkedDocument(response: Response, html: string, navId: string): Response | null {
  const contentType = response.headers.get("content-type") ?? "";
  if (!isValidNavigateShellDocument(html, contentType, null, navId)) return null;
  const headers = new Headers(response.headers);
  headers.set("x-hike-navigate-shell", NAVIGATE_SHELL_MARKER);
  return new Response(stampNavigateShellHtml(html), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function manifestUrl(navId: string): URL | null {
  if (typeof window === "undefined") return null;
  return new URL(`/__klandagi__/navigate-manifest/${encodeURIComponent(navId)}`, window.location.origin);
}

function validManifest(value: unknown, navId: string, origin: string): value is NavigateAssetManifest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as NavigateAssetManifest;
  if (
    candidate.version !== NAVIGATE_MANIFEST_VERSION ||
    candidate.marker !== NAVIGATE_SHELL_MARKER ||
    candidate.navId !== navId ||
    typeof candidate.shellUrl !== "string" ||
    !Array.isArray(candidate.assetUrls) ||
    candidate.assetUrls.length < 1 ||
    candidate.assetUrls.length > MAX_NAVIGATE_ASSETS ||
    new Set(candidate.assetUrls).size !== candidate.assetUrls.length ||
    !Number.isFinite(Date.parse(candidate.cachedAt))
  ) return false;
  try {
    const shell = new URL(candidate.shellUrl);
    if (shell.origin !== origin || shell.pathname !== `/navigate/${encodeURIComponent(navId)}`) return false;
    return candidate.assetUrls.every((raw) => {
      const asset = new URL(raw);
      return asset.origin === origin && asset.pathname.startsWith("/_next/static/");
    });
  } catch {
    return false;
  }
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
      navId,
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
  const fail = (error: string, status: Partial<NavigateOfflineStatus> = {}): WarmNavigateShellResult => ({
    ...EMPTY_STATUS,
    ...status,
    ok: false,
    error,
  });
  if (!url || typeof caches === "undefined") return fail("Offline cache is unavailable in this browser.");
  if (typeof navigator === "undefined" || !navigator.onLine) return fail("Reconnect to cache the navigation screen.");
  try {
    const response = await fetch(url.toString(), { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) return fail(`Navigation screen could not be cached (${response.status}).`);
    const html = await response.clone().text();
    const marked = ownMarkedDocument(response, html, navId);
    if (!marked) return fail("Navigation screen response did not prove that it was the requested route.");
    const assets = nextStaticUrls(html, url);
    if (assets.length < 1) return fail("Navigation screen listed no versioned app files, so offline readiness cannot be verified.");
    if (assets.length > MAX_NAVIGATE_ASSETS) return fail("Navigation screen listed too many app files to verify safely.");
    const shellCache = await caches.open(NAVIGATE_SHELL_CACHE);
    const assetCache = await caches.open(NAVIGATE_ASSETS_CACHE);
    const missingAssets: string[] = [];
    await Promise.all(assets.map(async (assetUrl) => {
      try {
        const asset = await fetch(assetUrl.toString(), { cache: "no-store", credentials: "same-origin" });
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
    const manifestKey = manifestUrl(navId);
    if (!manifestKey) return fail("Navigation manifest could not be created.");
    const manifest: NavigateAssetManifest = {
      version: NAVIGATE_MANIFEST_VERSION,
      marker: NAVIGATE_SHELL_MARKER,
      navId,
      shellUrl: url.toString(),
      assetUrls: assets.map((asset) => asset.toString()),
      cachedAt: new Date().toISOString(),
    };
    await shellCache.put(manifestKey.toString(), new Response(JSON.stringify(manifest), {
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    }));

    // Slow browsers can expose Cache Storage writes a few ticks later.
    for (let attempt = 0; attempt < 15; attempt += 1) {
      const status = await getNavigateOfflineStatus(navId);
      if (status.ready) return { ...status, ok: true };
      if (status.filesReady && !status.serviceWorkerControlled) {
        return fail(
          "Files are saved, but this page is not controlled by the service worker yet. Close and reopen the installed app, then verify again.",
          status,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const status = await getNavigateOfflineStatus(navId);
    return fail("Navigation files were written but failed complete verification.", status);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Navigation screen could not be cached.");
  }
}

export async function isNavigateShellCached(navId: string): Promise<boolean> {
  return (await getNavigateOfflineStatus(navId)).filesReady;
}

export async function getNavigateOfflineStatus(navId: string): Promise<NavigateOfflineStatus> {
  const shellUrl = navigateUrl(navId);
  const manifestKey = manifestUrl(navId);
  if (!shellUrl || !manifestKey || typeof caches === "undefined") return EMPTY_STATUS;
  const shellCached = await readCachedShell(navId);
  let manifest: NavigateAssetManifest | null = null;
  try {
    const shellCache = await caches.open(NAVIGATE_SHELL_CACHE);
    const response = await shellCache.match(manifestKey.toString(), { ignoreVary: true });
    const parsed = response ? await response.json() : null;
    if (validManifest(parsed, navId, shellUrl.origin)) manifest = parsed;
  } catch {
    manifest = null;
  }
  const missingAssets: string[] = [];
  if (manifest) {
    const assetCache = await caches.open(NAVIGATE_ASSETS_CACHE);
    for (const assetUrl of manifest.assetUrls) {
      const hit = await assetCache.match(assetUrl, { ignoreVary: true });
      if (!hit || !hit.ok) missingAssets.push(assetUrl);
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

export async function removeNavigateShell(navId: string): Promise<void> {
  const shellUrl = navigateUrl(navId);
  const manifestKey = manifestUrl(navId);
  if (!shellUrl || !manifestKey || typeof caches === "undefined") return;
  const shellCache = await caches.open(NAVIGATE_SHELL_CACHE);
  await Promise.all([
    shellCache.delete(shellUrl.toString(), { ignoreSearch: true }),
    shellCache.delete(manifestKey.toString()),
  ]);
}
