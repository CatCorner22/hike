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
    } catch {
      sentinel = null;
    }
  };

  await acquire();

  const onVisible = () => {
    if (document.visibilityState === "visible") void acquire();
  };
  document.addEventListener("visibilitychange", onVisible);

  return {
    release() {
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release();
    },
  };
}
