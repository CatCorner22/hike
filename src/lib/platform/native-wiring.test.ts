import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetPlatformAdaptersForTests,
  setPlatformAdapters,
} from "@/lib/platform/adapters";
import { startGeoWatch } from "@/lib/platform/geolocation";
import { vibrateOffTrail } from "@/lib/safety/alerts";
import { SOS_VIBRATION_PATTERN, vibrateSos } from "@/lib/safety/strobe";
import { downloadTextFile } from "@/lib/safety/field";
import { requestWakeLock, isWakeLockHeld, releaseWakeLock, __resetWakeLockForTests } from "@/lib/offline/wake-lock";
import { isStoragePersistent, requestPersistentStorage } from "@/lib/offline/storage";
import { getNavigateOfflineStatus, warmNavigateShell } from "@/lib/offline/navigate-shell";
import { OVERDUE_NOTIFICATION_ID } from "@/lib/platform/overdue-notification";
import { setOverdueAlarm, __resetSafetyDbForTest } from "@/lib/safety/profile";

function enterNativeShell() {
  (globalThis as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
}

function leaveNativeShell() {
  delete (globalThis as { Capacitor?: unknown }).Capacitor;
}

afterEach(() => {
  __resetPlatformAdaptersForTests();
  __resetWakeLockForTests();
  leaveNativeShell();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("geolocation seam", () => {
  it("routes through a registered adapter and stops its watcher", () => {
    const stop = vi.fn();
    const watch = vi.fn(() => ({ stop }));
    setPlatformAdapters({ geolocation: { watch } });
    const onFix = vi.fn();
    const onError = vi.fn();

    const unsubscribe = startGeoWatch(onFix, onError, { background: true, enableHighAccuracy: true });

    expect(watch).toHaveBeenCalledWith(onFix, onError, { background: true });
    unsubscribe();
    expect(stop).toHaveBeenCalledOnce();
  });

  it("falls back to navigator.geolocation with the caller's options", () => {
    const clearWatch = vi.fn();
    const watchPosition =
      vi.fn<(onFix: PositionCallback, onError: PositionErrorCallback, options?: PositionOptions) => number>(
        () => 77,
      );
    vi.stubGlobal("navigator", { geolocation: { watchPosition, clearWatch } });

    const unsubscribe = startGeoWatch(vi.fn(), vi.fn(), {
      background: false,
      enableHighAccuracy: true,
      maximumAge: 3000,
      timeout: 20000,
    });

    expect(watchPosition).toHaveBeenCalledOnce();
    expect(watchPosition.mock.calls[0][2]).toEqual({
      enableHighAccuracy: true,
      maximumAge: 3000,
      timeout: 20000,
    });
    unsubscribe();
    expect(clearWatch).toHaveBeenCalledWith(77);
  });

  it("reports unavailability through the error callback instead of throwing", async () => {
    vi.stubGlobal("navigator", {});
    const onError = vi.fn();
    startGeoWatch(vi.fn(), onError, { background: false });
    await new Promise((resolve) => queueMicrotask(() => resolve(undefined)));
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0].code).toBe(2);
  });
});

describe("haptics seam consumers", () => {
  /**
   * Regression: navigator.vibrate does not exist on iOS, so the off-trail
   * pulses and the SOS Morse pattern were silently dead there. Both call
   * sites must route through the seam so a registered adapter revives them.
   */
  it("off-trail and SOS vibrations reach a registered adapter", () => {
    const vibrate = vi.fn(() => true);
    setPlatformAdapters({ haptics: { vibrate } });

    vibrateOffTrail("critical");
    expect(vibrate).toHaveBeenCalledWith([200, 100, 200, 100, 400]);

    vibrateSos();
    expect(vibrate).toHaveBeenLastCalledWith(SOS_VIBRATION_PATTERN);
  });
});

describe("save-file seam consumer", () => {
  it("downloadTextFile prefers a registered adapter over the anchor flow", () => {
    const saveText = vi.fn(async () => true);
    setPlatformAdapters({ saveFile: { saveText } });

    downloadTextFile("track.gpx", "<gpx/>", "application/gpx+xml");

    expect(saveText).toHaveBeenCalledWith("track.gpx", "<gpx/>", "application/gpx+xml");
  });
});

describe("wake lock through the adapter", () => {
  it("reports held only when the adapter's acquire succeeded", async () => {
    const acquire = vi.fn(async () => true);
    const release = vi.fn(async () => undefined);
    setPlatformAdapters({ wakeLock: { acquire, release } });

    const lock = await requestWakeLock();
    expect(isWakeLockHeld()).toBe(true);

    lock.release();
    expect(release).toHaveBeenCalledOnce();
    expect(isWakeLockHeld()).toBe(false);
  });

  it("reports not-held when the adapter refuses", async () => {
    setPlatformAdapters({
      wakeLock: { acquire: async () => false, release: async () => undefined },
    });
    await requestWakeLock();
    expect(isWakeLockHeld()).toBe(false);
    await releaseWakeLock();
  });
});

describe("native shell truthfulness", () => {
  it("storage reports persistent inside the shell without asking the browser", async () => {
    enterNativeShell();
    expect(await isStoragePersistent()).toBe(true);
    expect(await requestPersistentStorage()).toBe(true);
  });

  /**
   * Regression guard for the readiness gate: the shell bundles every asset and
   * runs no service worker, so shell status must be ready by construction —
   * otherwise navigation stays locked forever on the platform where offline
   * launch is guaranteed.
   */
  it("navigate shell reports ready inside the shell", async () => {
    enterNativeShell();
    expect((await getNavigateOfflineStatus()).ready).toBe(true);
    expect((await warmNavigateShell()).ok).toBe(true);
  });
});

describe("overdue notification tracks the stored alarm", () => {
  beforeEach(() => {
    __resetSafetyDbForTest();
  });

  it("schedules on set and cancels on clear, through the store's own writer", async () => {
    const scheduleAt =
      vi.fn<(id: number, atMs: number, title: string, body: string) => Promise<boolean>>(async () => true);
    const cancel = vi.fn<(id: number) => Promise<void>>(async () => undefined);
    setPlatformAdapters({ notifications: { scheduleAt, cancel } });

    const returnAt = new Date(Date.now() + 2 * 3600_000);
    const stored = await setOverdueAlarm({
      instant: returnAt,
      resolvedLocal: "2026-08-23 18:00",
      timeZone: "America/Los_Angeles",
      utcOffset: "GMT-7",
    });
    expect(stored).toBe(true);
    await vi.waitFor(() => {
      expect(scheduleAt).toHaveBeenCalledOnce();
    });
    expect(scheduleAt.mock.calls[0][0]).toBe(OVERDUE_NOTIFICATION_ID);
    expect(scheduleAt.mock.calls[0][1]).toBe(returnAt.getTime());

    expect(await setOverdueAlarm(null)).toBe(true);
    await vi.waitFor(() => {
      expect(cancel).toHaveBeenCalledWith(OVERDUE_NOTIFICATION_ID);
    });
  });
});
