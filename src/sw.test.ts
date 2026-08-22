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
});
