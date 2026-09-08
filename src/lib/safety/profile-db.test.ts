import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const openDB = vi.fn();
vi.mock("idb", () => ({ openDB: (...args: unknown[]) => openDB(...args) }));

import {
  __resetSafetyDbForTest,
  getIceProfile,
  getSafetyDb,
  listWaypoints,
  saveIceProfile,
  setOverdueAlarm,
} from "./profile";
import { getCheckinSettings, saveCheckinSettings } from "./checkin";

/**
 * `getSafetyDb` cached its `openDB` promise forever. A rejection — storage denied in a
 * private window, quota exhausted, a corrupt store — was therefore permanent, and no
 * caller has a `catch`: the readiness gate and safety panel never set their state, and
 * `unlockIfReady` never reached `setNavUnlocked(true)`, so Navigate stayed locked with
 * nothing on screen saying why. A blocked upgrade (another tab holding an older version)
 * never settled at all, with the same result.
 */
describe("safety database availability", () => {
  beforeEach(() => {
    vi.stubGlobal("indexedDB", {});
    openDB.mockReset();
    __resetSafetyDbForTest();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    __resetSafetyDbForTest();
  });

  it("degrades to an empty profile when the store cannot be opened", async () => {
    openDB.mockRejectedValue(new DOMException("denied", "SecurityError"));
    await expect(getIceProfile()).resolves.toMatchObject({ name: "", partySize: 1 });
    await expect(listWaypoints("pack-1")).resolves.toEqual([]);
  });

  it("retries a failed open instead of caching the failure for the session", async () => {
    openDB.mockRejectedValueOnce(new DOMException("denied", "SecurityError"));
    await expect(getIceProfile()).resolves.toMatchObject({ name: "" });

    const stored = { id: "me", name: "Rae", iceName: "Sam", icePhone: "555", medical: "", partySize: 2 };
    openDB.mockResolvedValue({ get: async () => stored });
    await expect(getIceProfile()).resolves.toMatchObject({ name: "Rae", partySize: 2 });
    expect(openDB).toHaveBeenCalledTimes(2);
  });

  it("does not wait forever on an upgrade another tab is blocking", async () => {
    vi.useFakeTimers();
    openDB.mockReturnValue(new Promise(() => {}));
    const pending = getSafetyDb();
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(pending).resolves.toBeNull();
    // Still blocked on the retry, and still does not hang.
    const profile = getIceProfile();
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(profile).resolves.toMatchObject({ name: "" });
    // One pending open reused, not a new connection stacked per call.
    expect(openDB).toHaveBeenCalledTimes(1);
  });

  it("closes its own connection when it is the one blocking another tab's upgrade", async () => {
    for (const fireEarly of [false, true]) {
      __resetSafetyDbForTest();
      openDB.mockReset();
      const close = vi.fn();
      let blocking: (() => void) | undefined;
      openDB.mockImplementation(async (_name, _version, callbacks) => {
        blocking = (callbacks as { blocking: () => void }).blocking;
        // `fireEarly` lands in the microtasks between openDB resolving and the
        // module assigning the connection — the window a naive handler misses.
        if (fireEarly) queueMicrotask(() => blocking?.());
        return { close, get: async () => undefined };
      });
      await getIceProfile();
      if (!fireEarly) blocking?.();
      await Promise.resolve();
      await Promise.resolve();
      expect(close, `fireEarly=${fireEarly}`).toHaveBeenCalled();
    }
  });
});

/**
 * The panel wrote "Deadline: ..." before awaiting the store and did `void
 * saveIceProfile(next)`, so a refused write showed as success — an overdue alarm that
 * looked armed and did nothing, and an ICE contact that was gone on next launch.
 */
describe("storage failures are reported, not swallowed", () => {
  beforeEach(() => {
    vi.stubGlobal("indexedDB", {});
    openDB.mockReset();
    __resetSafetyDbForTest();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    __resetSafetyDbForTest();
  });

  const profile = { name: "Rae", iceName: "Sam", icePhone: "555", medical: "", partySize: 2 };
  const deadline = {
    instant: new Date("2026-08-21T02:00:00Z"),
    resolvedLocal: "2026-08-20T19:00",
    timeZone: "America/Los_Angeles",
    utcOffset: "GMT-7",
  };

  it("reports false when the write is refused", async () => {
    openDB.mockResolvedValue({
      put: async () => {
        throw new DOMException("quota", "QuotaExceededError");
      },
      delete: async () => {
        throw new DOMException("quota", "QuotaExceededError");
      },
    });
    await expect(saveIceProfile(profile)).resolves.toBe(false);
    await expect(setOverdueAlarm(deadline)).resolves.toBe(false);
    await expect(setOverdueAlarm(null)).resolves.toBe(false);
    await expect(saveCheckinSettings({ enabled: true, intervalMin: 60 })).resolves.toBe(false);
  });

  it("reports false when there is no store at all", async () => {
    openDB.mockRejectedValue(new DOMException("denied", "SecurityError"));
    await expect(saveIceProfile(profile)).resolves.toBe(false);
    await expect(setOverdueAlarm(deadline)).resolves.toBe(false);
  });

  it("reports true when the write lands", async () => {
    openDB.mockResolvedValue({ put: async () => "me", delete: async () => undefined });
    await expect(saveIceProfile(profile)).resolves.toBe(true);
    await expect(setOverdueAlarm(deadline)).resolves.toBe(true);
    await expect(setOverdueAlarm(null)).resolves.toBe(true);
  });

  it("round-trips the exact check-in arm time used by readiness verification", async () => {
    let row: { enabled: boolean; intervalMin: number; armedAt?: string } | undefined;
    openDB.mockResolvedValue({
      put: async (_store: string, value: typeof row) => {
        row = value;
        return "current";
      },
      get: async () => row,
    });
    // The readiness gate always arms with a fresh "now" and verifies the read-back
    // byte-for-byte; a stale armedAt is deliberately re-stamped by saveCheckinSettings.
    const settings = {
      enabled: true,
      intervalMin: 60,
      armedAt: new Date().toISOString(),
    };

    await expect(saveCheckinSettings(settings)).resolves.toBe(true);
    await expect(getCheckinSettings()).resolves.toEqual(settings);
  });
});
