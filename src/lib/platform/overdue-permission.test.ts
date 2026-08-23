import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setPlatformAdapters, type NotificationPermission } from "@/lib/platform/adapters";
import {
  __resetOverdueNotificationForTests,
  openOverdueNotificationSettings,
  requestOverduePermission,
  syncOverdueNotification,
} from "@/lib/platform/overdue-notification";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

afterEach(() => {
  setPlatformAdapters({});
  __resetOverdueNotificationForTests();
});

function adapter(overrides: {
  scheduled?: boolean;
  permission?: NotificationPermission;
  openSettings?: boolean;
}) {
  return {
    scheduleAt: vi.fn(async () => overrides.scheduled ?? true),
    cancel: vi.fn(async () => undefined),
    permission: vi.fn(async () => overrides.permission ?? "granted"),
    requestPermission: vi.fn(async () => overrides.permission ?? "granted"),
    openSettings: vi.fn(async () => overrides.openSettings ?? true),
  };
}

/**
 * A refusal has a cause, and the causes need different words: one is a button
 * the hiker can press, the other is a trip to Settings. Reporting both as
 * "failed" left the app saying an alarm was refused and nothing about what to
 * do next -- for the one feature the App Store listing leads with.
 */
describe("a refused overdue alarm says which refusal it was", () => {
  const future = Date.now() + 60 * 60_000;

  it("reports a denial as denied, not as a generic failure", async () => {
    setPlatformAdapters({ notifications: adapter({ scheduled: false, permission: "denied" }) });
    expect(await syncOverdueNotification(new Date(future))).toEqual({ status: "denied" });
  });

  it("reports an unasked permission as something one tap fixes", async () => {
    setPlatformAdapters({ notifications: adapter({ scheduled: false, permission: "prompt" }) });
    expect(await syncOverdueNotification(new Date(future))).toEqual({ status: "needs-permission" });
  });

  it("still reports a genuine failure as a failure", async () => {
    setPlatformAdapters({ notifications: adapter({ scheduled: false, permission: "granted" }) });
    expect(await syncOverdueNotification(new Date(future))).toEqual({ status: "failed" });
  });

  it("says scheduled when it is scheduled", async () => {
    setPlatformAdapters({ notifications: adapter({ scheduled: true }) });
    expect(await syncOverdueNotification(new Date(future))).toEqual({
      status: "scheduled",
      atMs: future,
    });
  });

  it("is unsupported on the web rather than broken", async () => {
    expect(await requestOverduePermission()).toBe("unsupported");
    expect(await openOverdueNotificationSettings()).toBe(false);
    expect(await syncOverdueNotification(new Date(future))).toEqual({ status: "unsupported" });
  });

  it("asks only through the adapter, and survives an adapter that throws", async () => {
    const throwing = {
      ...adapter({}),
      requestPermission: vi.fn(async () => {
        throw new Error("bridge gone");
      }),
      openSettings: vi.fn(async () => {
        throw new Error("bridge gone");
      }),
    };
    setPlatformAdapters({ notifications: throwing });
    expect(await requestOverduePermission()).toBe("prompt");
    expect(await openOverdueNotificationSettings()).toBe(false);
  });
});

/**
 * The Swift side cannot be executed here, so these assert the two properties the
 * whole fix depends on: that the alarm is marked time-sensitive at all, and that
 * the entitlement which lets that mark break through Focus is declared. Both are
 * compiled and booted by the simulator lane; neither is a substitute for the
 * on-device check in the runbook.
 */
describe("the native alarm is built to break through Focus", () => {
  const plugin = read("ios/App/App/OverduePlugin.swift");

  it("marks the notification time-sensitive, guarded for the deployment target", () => {
    expect(plugin).toMatch(/if #available\(iOS 15\.0, \*\)/);
    expect(plugin).toMatch(/content\.interruptionLevel = \.timeSensitive/);
  });

  it("declares the entitlement that makes the mark mean anything", () => {
    expect(read("ios/App/App/App.entitlements")).toMatch(
      /com\.apple\.developer\.usernotifications\.time-sensitive/,
    );
    const project = read("ios/App/App.xcodeproj/project.pbxproj");
    expect(project.match(/CODE_SIGN_ENTITLEMENTS = App\/App\.entitlements;/g) ?? []).toHaveLength(2);
    expect(project).toMatch(/OverduePlugin\.swift in Sources/);
  });

  it("is handed to the bridge, which app-local plugins are not discovered by", () => {
    expect(read("ios/App/App/MainViewController.swift")).toMatch(
      /registerPluginInstance\(OverduePlugin\(\)\)/,
    );
  });

  it("refuses to schedule into the past rather than firing instantly", () => {
    expect(plugin).toMatch(/fireDate\.timeIntervalSinceNow > 0/);
  });

  it("anchors the trigger in UTC so a drive across a timezone does not move it", () => {
    expect(plugin).toMatch(/TimeZone\(identifier: "UTC"\)/);
  });
});

/**
 * WKWebView kills its content process under memory pressure and Capacitor
 * reloads the page. The JS holding the watcher id dies; the CLLocationManager
 * does not. One orphan per kill, each at navigation accuracy, on the battery
 * that decides whether the hiker walks out.
 */
describe("location watchers do not outlive the page that opened them", () => {
  const register = read("src/lib/platform/capacitor/register.ts");

  it("persists every watcher id outside the page", () => {
    expect(register).toMatch(/const WATCHER_IDS_KEY = "klandagi-geo-watchers"/);
    expect(register).toMatch(/void rememberWatcher\(id\)/);
    expect(register).toMatch(/forgetWatcher\(id\)/);
  });

  it("keeps a list, because two watchers are legitimately live at once", () => {
    // The navigate screen's foreground fix and the recorder's background track.
    expect(register).toMatch(/JSON\.stringify\(\[\.\.\.ids, id\]\)/);
  });

  it("reclaims before any adapter is published, so nothing can start one first", () => {
    const bootstrap = read("src/components/platform/native-bootstrap.tsx");
    const reclaim = bootstrap.indexOf("await reclaimOrphanedGeoWatchers()");
    const publish = bootstrap.indexOf("setPlatformAdapters(buildCapacitorAdapters())");
    expect(reclaim).toBeGreaterThan(-1);
    expect(reclaim).toBeLessThan(publish);
  });
});
