import { afterEach, describe, expect, it, vi } from "vitest";
import { __resetPlatformAdaptersForTests, setPlatformAdapters } from "./adapters";
import { readBatteryStatus } from "./battery";
import { vibratePattern } from "./haptics";
import { isOnline, subscribeNetworkStatus } from "./network";

/**
 * The seam contract: with nothing registered, every seam behaves exactly like the
 * browser API it wraps (web behavior byte-identical to before the seam existed); with
 * an adapter registered, the adapter wins. This is what lets the Capacitor shell
 * revive iOS-dead features (battery warnings, haptic Morse, reliable connectivity)
 * without the web bundle ever importing a native module.
 */
afterEach(() => {
  __resetPlatformAdaptersForTests();
  vi.unstubAllGlobals();
});

describe("network seam", () => {
  it("falls back to navigator.onLine and its events on the web", () => {
    const listeners = new Map<string, () => void>();
    vi.stubGlobal("navigator", { onLine: false });
    vi.stubGlobal("window", {
      addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
    });
    expect(isOnline()).toBe(false);

    const seen: boolean[] = [];
    const unsubscribe = subscribeNetworkStatus((online) => seen.push(online));
    vi.stubGlobal("navigator", { onLine: true });
    listeners.get("online")?.();
    expect(seen).toEqual([true]);
    unsubscribe();
    expect(listeners.size).toBe(0);
  });

  it("prefers a registered adapter over the browser API", () => {
    vi.stubGlobal("navigator", { onLine: true });
    let subscribed = 0;
    setPlatformAdapters({
      network: {
        isOnline: () => false,
        subscribe: () => {
          subscribed += 1;
          return () => undefined;
        },
      },
    });
    expect(isOnline()).toBe(false);
    subscribeNetworkStatus(() => undefined);
    expect(subscribed).toBe(1);
  });
});

describe("battery seam", () => {
  it("returns null where navigator.getBattery does not exist (iOS web today)", async () => {
    vi.stubGlobal("navigator", {});
    expect(await readBatteryStatus()).toBeNull();
  });

  it("reads the web battery API when present and rejects nonsense levels", async () => {
    vi.stubGlobal("navigator", {
      getBattery: async () => ({ level: 0.42, charging: true }),
    });
    expect(await readBatteryStatus()).toEqual({ level: 0.42, charging: true });
    vi.stubGlobal("navigator", {
      getBattery: async () => ({ level: Number.NaN, charging: false }),
    });
    expect(await readBatteryStatus()).toBeNull();
  });

  it("prefers a registered adapter, and treats its failure as unknown", async () => {
    setPlatformAdapters({ battery: { read: async () => ({ level: 0.1, charging: false }) } });
    expect(await readBatteryStatus()).toEqual({ level: 0.1, charging: false });
    setPlatformAdapters({
      battery: {
        read: async () => {
          throw new Error("plugin died");
        },
      },
    });
    expect(await readBatteryStatus()).toBeNull();
  });
});

describe("haptics seam", () => {
  it("reports false where navigator.vibrate is absent (iOS web today) and validates patterns", () => {
    vi.stubGlobal("navigator", {});
    expect(vibratePattern([100, 50, 100])).toBe(false);
    vi.stubGlobal("navigator", { vibrate: () => true });
    expect(vibratePattern([])).toBe(false);
    expect(vibratePattern([Number.NaN])).toBe(false);
    expect(vibratePattern([100, 50, 100])).toBe(true);
  });

  it("routes the same pattern array through a registered adapter", () => {
    const received: number[][] = [];
    setPlatformAdapters({
      haptics: {
        vibrate: (pattern) => {
          received.push(pattern);
          return true;
        },
      },
    });
    expect(vibratePattern([120, 120, 360])).toBe(true);
    expect(received).toEqual([[120, 120, 360]]);
  });
});

describe("overdue notification seam", () => {
  function fakeNotifications() {
    const calls: string[] = [];
    return {
      calls,
      adapter: {
        scheduleAt: async (id: number, atMs: number) => {
          calls.push(`schedule:${id}@${atMs}`);
          return true;
        },
        cancel: async (id: number) => {
          calls.push(`cancel:${id}`);
        },
      },
    };
  }

  it("reports unsupported on the web instead of pretending an alarm exists", async () => {
    const { syncOverdueNotification } = await import("./overdue-notification");
    expect(await syncOverdueNotification("2026-08-23T18:00:00Z")).toEqual({ status: "unsupported" });
  });

  it("always cancels before scheduling, with one fixed id", async () => {
    const { OVERDUE_NOTIFICATION_ID, syncOverdueNotification } = await import("./overdue-notification");
    const fake = fakeNotifications();
    setPlatformAdapters({ notifications: fake.adapter });
    const now = Date.parse("2026-08-23T10:00:00Z");
    const at = Date.parse("2026-08-23T18:00:00Z");
    const result = await syncOverdueNotification("2026-08-23T18:00:00Z", now);
    expect(result).toEqual({ status: "scheduled", atMs: at });
    expect(fake.calls).toEqual([
      `cancel:${OVERDUE_NOTIFICATION_ID}`,
      `schedule:${OVERDUE_NOTIFICATION_ID}@${at}`,
    ]);
  });

  it("clears on null, on an unparseable time, and on a deadline already past", async () => {
    const { syncOverdueNotification } = await import("./overdue-notification");
    const now = Date.parse("2026-08-23T10:00:00Z");
    for (const returnAt of [null, "not-a-time", "2026-08-23T09:00:00Z"]) {
      const fake = fakeNotifications();
      setPlatformAdapters({ notifications: fake.adapter });
      const result = await syncOverdueNotification(returnAt, now);
      expect(result.status).toBe("cleared");
      expect(fake.calls).toHaveLength(1);
      expect(fake.calls[0]).toMatch(/^cancel:/);
    }
  });

  it("degrades an adapter failure to failed, never a false scheduled", async () => {
    const { syncOverdueNotification } = await import("./overdue-notification");
    setPlatformAdapters({
      notifications: {
        scheduleAt: async () => {
          throw new Error("plugin died");
        },
        cancel: async () => undefined,
      },
    });
    const now = Date.parse("2026-08-23T10:00:00Z");
    expect((await syncOverdueNotification("2026-08-23T18:00:00Z", now)).status).toBe("failed");
  });
});
