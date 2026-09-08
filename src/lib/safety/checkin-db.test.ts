import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { __resetSafetyDbForTest } from "./profile";
import { getCheckinSettings, logCheckin, saveCheckinSettings } from "./checkin";

describe("check-in monitor arming", () => {
  beforeEach(() => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    __resetSafetyDbForTest();
  });

  afterEach(() => {
    __resetSafetyDbForTest();
    vi.unstubAllGlobals();
  });

  /**
   * Arming marks the start of a monitoring session. A pause/resume that replayed the
   * previous session's armedAt re-armed the monitor already overdue — OVERDUE plus an
   * SOS prompt the instant it was switched on.
   */
  it("stamps a fresh armedAt when re-enabling, ignoring a stale caller value", async () => {
    const staleArm = new Date(Date.now() - 4 * 60 * 60_000).toISOString();
    await saveCheckinSettings({ enabled: true, intervalMin: 60, armedAt: staleArm });
    await saveCheckinSettings({ enabled: false, intervalMin: 60 });
    const before = Date.now();
    await saveCheckinSettings({ enabled: true, intervalMin: 60, armedAt: staleArm });
    const settings = await getCheckinSettings();
    expect(settings.enabled).toBe(true);
    expect(Date.parse(settings.armedAt!)).toBeGreaterThanOrEqual(before - 1000);
  });

  it("normalizes a corrupt stored interval instead of passing it through", async () => {
    await saveCheckinSettings({ enabled: true, intervalMin: Number.NaN });
    const settings = await getCheckinSettings();
    expect(settings.intervalMin).toBe(60);
  });

  it("reports whether a check-in write landed", async () => {
    const landed = await logCheckin("pack-1", { note: "ok" });
    expect(landed.saved).toBe(true);
    // No IndexedDB at all: the entry comes back for display but is marked unsaved.
    __resetSafetyDbForTest();
    vi.stubGlobal("indexedDB", undefined);
    const refused = await logCheckin("pack-1", { note: "ok" });
    expect(refused.saved).toBe(false);
  });
});
