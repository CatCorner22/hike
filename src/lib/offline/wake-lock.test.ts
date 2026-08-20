import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetWakeLockForTests,
  isWakeLockHeld,
  releaseWakeLock,
  requestWakeLock,
  subscribeWakeLock,
} from "./wake-lock";

type ReleaseListener = () => void;

/** Minimal stand-in for a WakeLockSentinel, which is an EventTarget in the spec. */
function makeSentinel() {
  const listeners = new Set<ReleaseListener>();
  return {
    released: false,
    release: vi.fn(async function (this: { released: boolean }) {
      this.released = true;
    }),
    addEventListener: (_type: "release", listener: ReleaseListener) => listeners.add(listener),
    removeEventListener: (_type: "release", listener: ReleaseListener) => listeners.delete(listener),
    /** Simulate the browser dropping the lock on its own. */
    fireRelease: () => listeners.forEach((listener) => listener()),
  };
}

let sentinels: ReturnType<typeof makeSentinel>[] = [];
let visibility: DocumentVisibilityState = "visible";
let visibilityListeners: Array<() => void> = [];

beforeEach(() => {
  __resetWakeLockForTests();
  sentinels = [];
  visibility = "visible";
  visibilityListeners = [];
  vi.stubGlobal("navigator", {
    wakeLock: {
      request: vi.fn(async () => {
        const sentinel = makeSentinel();
        sentinels.push(sentinel);
        return sentinel;
      }),
    },
  });
  vi.stubGlobal("document", {
    get visibilityState() {
      return visibility;
    },
    addEventListener: (_type: string, listener: () => void) => visibilityListeners.push(listener),
    removeEventListener: (_type: string, listener: () => void) => {
      visibilityListeners = visibilityListeners.filter((entry) => entry !== listener);
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  __resetWakeLockForTests();
});

describe("wake lock state", () => {
  it("reports held after a successful acquire", async () => {
    await requestWakeLock();
    expect(isWakeLockHeld()).toBe(true);
  });

  /**
   * Regression: nothing listened for the sentinel's `release` event, so once acquired the
   * flag stayed true forever. The pre-departure self-check then told a hiker "Screen wake
   * lock is held" while the browser had already dropped it — and the screen sleeps
   * mid-navigation, taking the off-trail banner with it.
   */
  it("stops reporting held when the browser releases the lock on its own", async () => {
    await requestWakeLock();
    expect(isWakeLockHeld()).toBe(true);

    sentinels[0].fireRelease();
    expect(isWakeLockHeld()).toBe(false);
  });

  it("notifies subscribers when the state changes", async () => {
    const seen: boolean[] = [];
    subscribeWakeLock(() => seen.push(isWakeLockHeld()));

    await requestWakeLock();
    sentinels[0].fireRelease();
    await releaseWakeLock();

    expect(seen).toContain(true);
    expect(seen).toContain(false);
  });

  it("re-acquires when the page becomes visible again", async () => {
    await requestWakeLock();
    sentinels[0].fireRelease();
    expect(isWakeLockHeld()).toBe(false);

    visibility = "visible";
    await Promise.all(visibilityListeners.map((listener) => listener()));
    await Promise.resolve();
    expect(isWakeLockHeld()).toBe(true);
    expect(sentinels).toHaveLength(2);
  });

  it("reports not held while the page is hidden", async () => {
    await requestWakeLock();
    visibility = "hidden";
    visibilityListeners.forEach((listener) => listener());
    expect(isWakeLockHeld()).toBe(false);
  });

  it("reports not held when the browser has no wake lock API", async () => {
    vi.stubGlobal("navigator", {});
    await requestWakeLock();
    expect(isWakeLockHeld()).toBe(false);
  });

  it("reports not held when the request is refused", async () => {
    vi.stubGlobal("navigator", {
      wakeLock: { request: vi.fn(async () => { throw new Error("denied"); }) },
    });
    await requestWakeLock();
    expect(isWakeLockHeld()).toBe(false);
  });

  it("does not leak a visibility listener when acquired twice", async () => {
    await requestWakeLock();
    await requestWakeLock();
    expect(visibilityListeners).toHaveLength(1);
    await releaseWakeLock();
    expect(visibilityListeners).toHaveLength(0);
    expect(isWakeLockHeld()).toBe(false);
  });
});
