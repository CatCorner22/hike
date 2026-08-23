import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NAVIGATE_SHELL_MARKER } from "@/lib/offline/navigate-shell-validation";

vi.mock("@serwist/next/worker", () => ({ defaultCache: [] }));
vi.mock("serwist", () => ({
  CacheFirst: class CacheFirst {},
  ExpirationPlugin: class ExpirationPlugin {},
  NetworkOnly: class NetworkOnly {},
  Serwist: class Serwist {
    addEventListeners() {}
  },
}));

const SHELL_CACHE = "hike-navigate-shell";
const shellOpens = (open: ReturnType<typeof vi.fn>) =>
  open.mock.calls.filter((call) => call[0] === SHELL_CACHE).length;
const shellPuts = (put: ReturnType<typeof vi.fn>) =>
  put.mock.calls.filter((call) => String(call[0]).includes("nav-diag") === false);

const NAV_ID = "plan-prepared";
const NAV_URL = `https://example.test/navigate/${NAV_ID}`;
const VALID_SHELL = `<!doctype html><html><body><main data-hike-navigate-shell="${NAV_ID}"><!--${NAVIGATE_SHELL_MARKER}--><script src="/_next/static/chunks/main.js"></script></main></body></html>`.padEnd(
  600,
  " ",
);

describe("navigate service-worker shell handler", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("self", { __SW_MANIFEST: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("returns a verified prepared shell without waiting for a network fetch that never settles", async () => {
    const prepared = new Response(VALID_SHELL, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "x-hike-navigate-shell": NAVIGATE_SHELL_MARKER,
      },
    });
    const cache = {
      match: vi.fn(async () => prepared.clone()),
      keys: vi.fn(async () => []),
      put: vi.fn(async () => undefined),
    } as unknown as Cache;
    const fetchNeverSettles = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("caches", { open: vi.fn(async () => cache) });
    vi.stubGlobal("fetch", fetchNeverSettles);

    const { navigateShellHandler } = await import("./sw");
    const timedOut = Symbol("timed out waiting for prepared shell");
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      navigateShellHandler({ request: new Request(NAV_URL) }),
      new Promise<typeof timedOut>((resolve) => {
        timeout = setTimeout(() => resolve(timedOut), 100);
      }),
    ]);
    if (timeout) clearTimeout(timeout);

    expect(result).not.toBe(timedOut);
    expect(result).toBeInstanceOf(Response);
    expect(await (result as Response).text()).toContain(`data-hike-navigate-shell="${NAV_ID}"`);
    expect(fetchNeverSettles).not.toHaveBeenCalled();
  });

  it("refuses a prepared shell for a different route when the network is unavailable", async () => {
    const wrongRouteShell = VALID_SHELL.replaceAll(NAV_ID, "plan-someone-else");
    const prepared = new Response(wrongRouteShell, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "x-hike-navigate-shell": NAVIGATE_SHELL_MARKER,
      },
    });
    const cache = {
      match: vi.fn(async () => prepared.clone()),
      keys: vi.fn(async () => []),
      put: vi.fn(async () => undefined),
    } as unknown as Cache;
    const failedFetch = vi.fn(async () => {
      throw new TypeError("network unavailable");
    });
    vi.stubGlobal("caches", { open: vi.fn(async () => cache) });
    vi.stubGlobal("fetch", failedFetch);

    const { navigateShellHandler } = await import("./sw");
    const result = await navigateShellHandler({ request: new Request(NAV_URL) });
    const body = await result.text();

    expect(failedFetch).toHaveBeenCalledOnce();
    expect(body).toContain("Offline navigation is unavailable");
    expect(body).not.toContain("plan-someone-else");
  });

  it("retries a transient Cache Storage read after the offline fetch fails", async () => {
    const prepared = new Response(VALID_SHELL, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "x-hike-navigate-shell": NAVIGATE_SHELL_MARKER,
      },
    });
    const cache = {
      match: vi.fn(async () => prepared.clone()),
      keys: vi.fn(async () => []),
      put: vi.fn(async () => undefined),
    } as unknown as Cache;
    const open = vi.fn()
      .mockRejectedValueOnce(new DOMException("cache waking", "InvalidStateError"))
      .mockResolvedValue(cache);
    vi.stubGlobal("caches", { open });
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("network unavailable");
    }));

    const { navigateShellHandler } = await import("./sw");
    const result = await navigateShellHandler({ request: new Request(NAV_URL) });

    expect(await result.text()).toContain(`data-hike-navigate-shell="${NAV_ID}"`);
    // Scoped to the shell cache: the handler also records its decision into a
    // separate diagnostic cache, which is not what this test constrains.
    expect(shellOpens(open)).toBe(2);
  });

  it("recovers a verified cache entry while a degraded network fetch remains pending", async () => {
    const prepared = new Response(VALID_SHELL, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "x-hike-navigate-shell": NAVIGATE_SHELL_MARKER,
      },
    });
    const cache = {
      match: vi.fn(async () => prepared.clone()),
      keys: vi.fn(async () => []),
      put: vi.fn(async () => undefined),
    } as unknown as Cache;
    const open = vi.fn()
      .mockRejectedValueOnce(new DOMException("cache waking", "InvalidStateError"))
      .mockResolvedValue(cache);
    vi.stubGlobal("caches", { open });
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));

    const { navigateShellHandler } = await import("./sw");
    const result = await navigateShellHandler({ request: new Request(NAV_URL) });

    expect(await result.text()).toContain(`data-hike-navigate-shell="${NAV_ID}"`);
    expect(shellOpens(open)).toBe(2);
  });

  it("bounds unavailable Cache Storage and a never-settling network", async () => {
    vi.useFakeTimers();
    const open = vi.fn(() => new Promise<Cache>(() => {}));
    vi.stubGlobal("caches", { open });
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));

    const { navigateShellHandler } = await import("./sw");
    const pending = navigateShellHandler({ request: new Request(NAV_URL) });
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await pending;

    expect(await result.text()).toContain("Offline navigation is unavailable");
    expect(shellOpens(open)).toBe(5);
  });

  it("uses a recovered exact-route shell instead of an invalid live document", async () => {
    const miss = {
      match: vi.fn(async () => undefined),
      keys: vi.fn(async () => []),
      put: vi.fn(async () => undefined),
    } as unknown as Cache;
    const prepared = new Response(VALID_SHELL, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "x-hike-navigate-shell": NAVIGATE_SHELL_MARKER,
      },
    });
    const hit = {
      match: vi.fn(async () => prepared.clone()),
      keys: vi.fn(async () => []),
      put: vi.fn(async () => undefined),
    } as unknown as Cache;
    vi.stubGlobal("caches", {
      open: vi.fn().mockResolvedValueOnce(miss).mockResolvedValue(hit),
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not a route document", {
      headers: { "content-type": "text/plain" },
    })));

    const { navigateShellHandler } = await import("./sw");
    const result = await navigateShellHandler({ request: new Request(NAV_URL) });

    expect(await result.text()).toContain(`data-hike-navigate-shell="${NAV_ID}"`);
  });

  it("stamps and sanitizes a valid live document before caching it", async () => {
    const cache = {
      match: vi.fn(async () => undefined),
      keys: vi.fn(async () => []),
      put: vi.fn(async () => undefined),
    } as unknown as Cache;
    vi.stubGlobal("caches", { open: vi.fn(async () => cache) });
    const unmarked = VALID_SHELL.replace(`<!--${NAVIGATE_SHELL_MARKER}-->`, "");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(unmarked, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-length": "999",
        etag: '"stale-wire-validator"',
      },
    })));

    const { navigateShellHandler } = await import("./sw");
    const result = await navigateShellHandler({ request: new Request(NAV_URL) });
    const cached = cache.put as unknown as ReturnType<typeof vi.fn>;
    const documentPuts = shellPuts(cached);
    const stored = documentPuts[0]?.[1] as Response;

    expect(result.status).toBe(200);
    expect(documentPuts).toHaveLength(1);
    expect(stored.headers.get("x-hike-navigate-shell")).toBe(NAVIGATE_SHELL_MARKER);
    expect(stored.headers.has("content-length")).toBe(false);
    expect(stored.headers.has("etag")).toBe(false);
    expect(await stored.text()).toContain(NAVIGATE_SHELL_MARKER);
  });

  it("does not abort a completed untrusted network response that must be returned", async () => {
    const cache = {
      match: vi.fn(async () => undefined),
      keys: vi.fn(async () => []),
      put: vi.fn(async () => undefined),
    } as unknown as Cache;
    vi.stubGlobal("caches", { open: vi.fn(async () => cache) });
    const captured: { signal: AbortSignal | null } = { signal: null };
    vi.stubGlobal("fetch", vi.fn(async (_request: Request, init?: RequestInit) => {
      captured.signal = init?.signal ?? null;
      return new Response("Temporarily unavailable", {
        status: 503,
        headers: { "content-type": "text/plain" },
      });
    }));

    const { navigateShellHandler } = await import("./sw");
    const result = await navigateShellHandler({ request: new Request(NAV_URL) });

    expect(result.status).toBe(503);
    expect(captured.signal?.aborted).toBe(false);
    expect(await result.text()).toBe("Temporarily unavailable");
  });

  it("keeps a near-deadline valid live response when its cache write stalls", async () => {
    vi.useFakeTimers();
    const cache = {
      match: vi.fn(async () => undefined),
      keys: vi.fn(async () => []),
      put: vi.fn(() => new Promise<void>(() => {})),
    } as unknown as Cache;
    vi.stubGlobal("caches", { open: vi.fn(async () => cache) });
    const captured: { signal: AbortSignal | null } = { signal: null };
    vi.stubGlobal("fetch", vi.fn((_request: Request, init?: RequestInit) => new Promise<Response>((resolve) => {
      captured.signal = init?.signal ?? null;
      setTimeout(() => resolve(new Response(VALID_SHELL, {
        headers: { "content-type": "text/html; charset=utf-8" },
      })), 4_800);
    })));

    const { navigateShellHandler } = await import("./sw");
    const pending = navigateShellHandler({ request: new Request(NAV_URL) });
    await vi.advanceTimersByTimeAsync(6_000);
    const result = await pending;

    expect(result.status).toBe(200);
    expect(captured.signal?.aborted).toBe(false);
    expect(await result.text()).toContain(`data-hike-navigate-shell="${NAV_ID}"`);
    expect(shellPuts(cache.put as unknown as ReturnType<typeof vi.fn>)).toHaveLength(1);
  });

  it("serves a valid live document even when caching that document fails", async () => {
    const cache = {
      match: vi.fn(async () => undefined),
      keys: vi.fn(async () => []),
      put: vi.fn(async () => {
        throw new DOMException("storage full", "QuotaExceededError");
      }),
    } as unknown as Cache;
    vi.stubGlobal("caches", { open: vi.fn(async () => cache) });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(VALID_SHELL, {
      headers: { "content-type": "text/html; charset=utf-8" },
    })));

    const { navigateShellHandler } = await import("./sw");
    const result = await navigateShellHandler({ request: new Request(NAV_URL) });

    expect(result.status).toBe(200);
    expect(await result.text()).toContain(`data-hike-navigate-shell="${NAV_ID}"`);
    expect(shellPuts(cache.put as unknown as ReturnType<typeof vi.fn>)).toHaveLength(1);
  });
});
