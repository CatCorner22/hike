import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const openDB = vi.fn();
vi.mock("idb", () => ({ openDB: (...args: unknown[]) => openDB(...args) }));

import { createIdbOpener, IdbOpenBlockedError } from "./idb-open";

/**
 * The pack, breadcrumb, nav-log, and pending-point stores all open IndexedDB
 * through this helper. Its whole reason to exist is that neither failure mode
 * of `openDB` may become permanent for the session: a rejection must not be
 * cached (the next call must genuinely retry), and a blocked upgrade must not
 * hang callers forever. See src/lib/safety/profile.ts for the incident this
 * pattern originally fixed.
 */
describe("createIdbOpener", () => {
  beforeEach(() => {
    vi.stubGlobal("indexedDB", {});
    openDB.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function makeOpener(blockedTimeoutMs = 1_000) {
    return createIdbOpener("test-db", 1, { upgrade: () => undefined }, { blockedTimeoutMs });
  }

  it("returns null when the browser has no IndexedDB", () => {
    vi.unstubAllGlobals();
    expect(makeOpener().getDb()).toBeNull();
  });

  it("propagates an open failure to the caller", async () => {
    openDB.mockRejectedValue(new DOMException("denied", "SecurityError"));
    await expect(makeOpener().getDb()).rejects.toThrow("denied");
  });

  it("retries a failed open instead of caching the rejection for the session", async () => {
    const opener = makeOpener();
    openDB.mockRejectedValueOnce(new DOMException("denied", "SecurityError"));
    await expect(opener.getDb()).rejects.toThrow("denied");

    const db = { close: vi.fn(), get: async () => "value" };
    openDB.mockResolvedValue(db);
    await expect(opener.getDb()).resolves.toBe(db);
    expect(openDB).toHaveBeenCalledTimes(2);
  });

  it("reuses the resolved connection instead of reopening per call", async () => {
    const opener = makeOpener();
    const db = { close: vi.fn() };
    openDB.mockResolvedValue(db);
    await expect(opener.getDb()).resolves.toBe(db);
    await expect(opener.getDb()).resolves.toBe(db);
    expect(openDB).toHaveBeenCalledTimes(1);
  });

  it("rejects with a blocked error instead of hanging on an upgrade another tab holds open", async () => {
    vi.useFakeTimers();
    openDB.mockReturnValue(new Promise(() => {}));
    const opener = makeOpener();
    const pending = opener.getDb();
    const outcome = expect(pending).rejects.toBeInstanceOf(IdbOpenBlockedError);
    await vi.advanceTimersByTimeAsync(1_500);
    await outcome;

    // The retry re-awaits the same pending open — no second connection stacked.
    const retry = opener.getDb();
    const retryOutcome = expect(retry).rejects.toBeInstanceOf(IdbOpenBlockedError);
    await vi.advanceTimersByTimeAsync(1_500);
    await retryOutcome;
    expect(openDB).toHaveBeenCalledTimes(1);
  });

  it("closes its own connection when it is the one blocking another tab's upgrade", async () => {
    for (const fireEarly of [false, true]) {
      openDB.mockReset();
      const close = vi.fn();
      let blocking: (() => void) | undefined;
      openDB.mockImplementation(async (_name, _version, callbacks) => {
        blocking = (callbacks as { blocking: () => void }).blocking;
        // `fireEarly` lands in the microtasks between openDB resolving and the
        // helper assigning the connection — the window a naive handler misses.
        if (fireEarly) queueMicrotask(() => blocking?.());
        return { close };
      });
      const opener = makeOpener();
      await opener.getDb();
      if (!fireEarly) blocking?.();
      await Promise.resolve();
      await Promise.resolve();
      expect(close).toHaveBeenCalled();

      // After letting go, the next call opens a fresh connection.
      await opener.getDb();
      expect(openDB).toHaveBeenCalledTimes(2);
    }
  });

  it("reopens after the browser terminates the connection", async () => {
    let terminated: (() => void) | undefined;
    const close = vi.fn();
    openDB.mockImplementation(async (_name, _version, callbacks) => {
      terminated = (callbacks as { terminated: () => void }).terminated;
      return { close };
    });
    const opener = makeOpener();
    await opener.getDb();
    terminated?.();
    await opener.getDb();
    expect(openDB).toHaveBeenCalledTimes(2);
  });

  it("reset closes the cached connection so the next call re-opens", async () => {
    const close = vi.fn();
    openDB.mockResolvedValue({ close });
    const opener = makeOpener();
    await opener.getDb();
    await opener.reset();
    expect(close).toHaveBeenCalled();
    await opener.getDb();
    expect(openDB).toHaveBeenCalledTimes(2);
  });
});
