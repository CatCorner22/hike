/**
 * Screen wake lock for the navigate screen.
 *
 * The pre-departure self-check reports "Screen wake lock is held" as one of six things a
 * hiker uses to decide whether they are ready to leave coverage. That claim has to be
 * true, so this tracks the real state rather than the last thing we asked for: the
 * browser releases a sentinel on its own when the document is hidden, and may drop it for
 * its own reasons (battery saver). Without listening for `release`, the flag stayed true
 * forever after the first successful acquire.
 */

type WakeLockSentinelLike = {
  released?: boolean;
  release: () => Promise<void>;
  addEventListener?: (type: "release", listener: () => void) => void;
  removeEventListener?: (type: "release", listener: () => void) => void;
};

export interface WakeLockHandle {
  release: () => void;
}

let activeLock: WakeLockHandle | null = null;
let lockHeld = false;
let sentinel: WakeLockSentinelLike | null = null;
const listeners = new Set<() => void>();

function setHeld(next: boolean) {
  if (next === lockHeld) return;
  lockHeld = next;
  for (const listener of [...listeners]) listener();
}

/** Subscribe to changes in whether the screen wake lock is actually held. */
export function subscribeWakeLock(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function requestWakeLock(): Promise<WakeLockHandle> {
  const nav = navigator as Navigator & {
    wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> };
  };

  if (!nav.wakeLock) {
    setHeld(false);
    return { release() {} };
  }

  // Releasing any previous lock first stops its visibilitychange listener leaking when
  // this is called twice without an intervening release.
  activeLock?.release();

  let onSentinelRelease: (() => void) | null = null;

  const detachSentinel = () => {
    if (sentinel && onSentinelRelease) {
      sentinel.removeEventListener?.("release", onSentinelRelease);
    }
    onSentinelRelease = null;
  };

  const acquire = async () => {
    detachSentinel();
    try {
      sentinel = await nav.wakeLock!.request("screen");
      onSentinelRelease = () => setHeld(false);
      sentinel.addEventListener?.("release", onSentinelRelease);
      setHeld(sentinel != null && sentinel.released !== true);
    } catch {
      sentinel = null;
      setHeld(false);
    }
  };

  const onVisible = () => {
    if (document.visibilityState === "visible") void acquire();
    else setHeld(false);
  };
  document.addEventListener("visibilitychange", onVisible);

  const lock: WakeLockHandle = {
    release() {
      document.removeEventListener("visibilitychange", onVisible);
      detachSentinel();
      void sentinel?.release();
      sentinel = null;
      setHeld(false);
      if (activeLock === lock) activeLock = null;
    },
  };

  // Publish the handle before acquiring. `isWakeLockHeld()` is `lockHeld && activeLock`,
  // so notifying subscribers while activeLock was still null made them read `false` for a
  // lock that had just been granted — and no further notification was coming.
  activeLock = lock;
  await acquire();
  return lock;
}

export function isWakeLockHeld(): boolean {
  return lockHeld && activeLock != null && sentinel?.released !== true;
}

export async function releaseWakeLock() {
  activeLock?.release();
  activeLock = null;
  setHeld(false);
  sentinel = null;
}

/** Test-only reset; not used by the application. */
export function __resetWakeLockForTests() {
  activeLock = null;
  lockHeld = false;
  sentinel = null;
  listeners.clear();
}
