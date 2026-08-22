import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch, mintSession, setTokenStore, type TokenStore } from "./client";

const fetchMock = vi.fn();

function nativeOn() {
  (globalThis as Record<string, unknown>).Capacitor = { isNativePlatform: () => true };
}
function nativeOff() {
  delete (globalThis as Record<string, unknown>).Capacitor;
}

function memoryStore(initial: string | null = null): TokenStore & { value: string | null } {
  const store = {
    value: initial,
    async read() {
      return store.value;
    },
    async write(token: string) {
      store.value = token;
    },
  };
  return store;
}

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("apiFetch", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    setTokenStore(null);
  });
  afterEach(() => {
    nativeOff();
    vi.unstubAllGlobals();
    setTokenStore(null);
  });

  /** Web behavior must be byte-identical to the plain fetch every call site used before. */
  it("on web: relative path, same-origin credentials, no Authorization header", async () => {
    fetchMock.mockResolvedValue(ok([]));
    await apiFetch("/api/plans", { method: "POST", body: "{}" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/plans");
    expect(init.credentials).toBe("same-origin");
    expect(init.method).toBe("POST");
    expect((init.headers ?? {}) as Record<string, string>).not.toHaveProperty("Authorization");
  });

  it("on native: prefixes the base, attaches the stored bearer", async () => {
    nativeOn();
    setTokenStore(memoryStore("owner-1.sig"));
    fetchMock.mockResolvedValue(ok([]));
    await apiFetch("/api/plans");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/plans$/);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer owner-1.sig");
  });

  it("on native with no stored token: mints once, then calls with the fresh token", async () => {
    nativeOn();
    const store = memoryStore(null);
    setTokenStore(store);
    fetchMock
      .mockResolvedValueOnce(ok({ token: "minted.sig" })) // POST /api/session
      .mockResolvedValueOnce(ok([])); // the real call
    const response = await apiFetch("/api/plans");
    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/session$/);
    expect((fetchMock.mock.calls[1][1].headers as Record<string, string>).Authorization).toBe(
      "Bearer minted.sig",
    );
    expect(store.value).toBe("minted.sig");
  });

  /**
   * A 401 means the server no longer accepts the stored token (rotated secret). Exactly
   * one re-mint + retry: recover if possible, surface the 401 if not, never loop.
   */
  it("on native 401: re-mints exactly once and retries", async () => {
    nativeOn();
    setTokenStore(memoryStore("stale.sig"));
    fetchMock
      .mockResolvedValueOnce(new Response("no", { status: 401 })) // first call
      .mockResolvedValueOnce(ok({ token: "fresh.sig" })) // re-mint
      .mockResolvedValueOnce(ok([{ id: 1 }])); // retry
    const response = await apiFetch("/api/plans");
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("on native 401 with mint also failing: surfaces the original 401, no loop", async () => {
    nativeOn();
    setTokenStore(memoryStore("stale.sig"));
    fetchMock
      .mockResolvedValueOnce(new Response("no", { status: 401 }))
      .mockResolvedValueOnce(new Response("down", { status: 503 })); // mint fails
    const response = await apiFetch("/api/plans");
    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("mintSession returns null offline instead of throwing", async () => {
    fetchMock.mockRejectedValue(new TypeError("Load failed"));
    expect(await mintSession()).toBeNull();
  });
});

describe("concurrent session minting", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    setTokenStore(null);
  });
  afterEach(() => {
    nativeOff();
    vi.unstubAllGlobals();
    setTokenStore(null);
  });

  /**
   * Cold install: several screens call the API at once with no stored token. Each mint
   * of a credential-less caller returns a DIFFERENT owner, so two mints would split the
   * user's data across two identities and orphan whichever lost the token write. All
   * concurrent callers must share ONE mint.
   */
  it("two concurrent cold-start calls perform exactly one mint and share the owner", async () => {
    nativeOn();
    setTokenStore(memoryStore(null));
    let mintCalls = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith("/api/session")) {
        mintCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return ok({ token: `owner-${mintCalls}.sig` });
      }
      return ok([]);
    });
    const [a, b] = await Promise.all([apiFetch("/api/plans"), apiFetch("/api/activities")]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(mintCalls).toBe(1);
    const authHeaders = fetchMock.mock.calls
      .filter(([url]) => !String(url).endsWith("/api/session"))
      .map(([, init]) => (init.headers as Record<string, string>).Authorization);
    expect(new Set(authHeaders).size).toBe(1);
  });
});
