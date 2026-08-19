let activeLock: { release: () => void } | null = null;
let lockHeld = false;

export async function requestWakeLock(): Promise<{ release: () => void }> {
  const nav = navigator as Navigator & {
    wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> };
  };

  if (!nav.wakeLock) {
    return { release() {} };
  }

  let sentinel: { release: () => Promise<void> } | null = null;

  const acquire = async () => {
    try {
      sentinel = await nav.wakeLock!.request("screen");
      lockHeld = sentinel != null;
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
      void sentinel?.release();
      lockHeld = false;
      if (activeLock === lock) activeLock = null;
    },
  };

  activeLock = lock;
  return lock;
}

export function isWakeLockHeld(): boolean {
  return lockHeld && activeLock != null;
}

export async function releaseWakeLock() {
  activeLock?.release();
  activeLock = null;
  lockHeld = false;
}
