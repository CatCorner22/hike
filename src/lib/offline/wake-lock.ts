type WakeLockSentinelLike = {
  released?: boolean;
  release: () => Promise<void>;
  addEventListener?: (type: "release", listener: () => void) => void;
  removeEventListener?: (type: "release", listener: () => void) => void;
};

let activeLock: { release: () => void } | null = null;
let lockHeld = false;
let sentinel: WakeLockSentinelLike | null = null;

export async function requestWakeLock(): Promise<{ release: () => void }> {
  const nav = navigator as Navigator & {
    wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> };
  };

  if (!nav.wakeLock) {
    return { release() {} };
  }

  const onSentinelRelease = () => {
    lockHeld = false;
    sentinel = null;
  };

  const acquire = async () => {
    try {
      sentinel?.removeEventListener?.("release", onSentinelRelease);
      sentinel = await nav.wakeLock!.request("screen");
      lockHeld = sentinel != null && sentinel.released !== true;
      sentinel?.addEventListener?.("release", onSentinelRelease);
    } catch {
      sentinel = null;
      lockHeld = false;
    }
  };

  await acquire();

  const onVisible = () => {
    if (document.visibilityState === "visible") void acquire();
  };
  document.addEventListener("visibilitychange", onVisible);

  const lock = {
    release() {
      document.removeEventListener("visibilitychange", onVisible);
      sentinel?.removeEventListener?.("release", onSentinelRelease);
      void sentinel?.release();
      lockHeld = false;
      sentinel = null;
      if (activeLock === lock) activeLock = null;
    },
  };

  activeLock = lock;
  return lock;
}

export function isWakeLockHeld(): boolean {
  return lockHeld && activeLock != null && sentinel?.released !== true;
}

export async function releaseWakeLock() {
  activeLock?.release();
  activeLock = null;
  lockHeld = false;
  sentinel = null;
}
