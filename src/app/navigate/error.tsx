"use client";

import { useEffect } from "react";

/**
 * Error boundary for the navigate screen.
 *
 * The app previously had no error boundary anywhere. A render error in any of
 * the client components on this route unmounted the tree, so a hiker mid-trail
 * lost the map, the off-trail alert and the emergency controls at once, with no
 * indication of what had happened.
 *
 * This fallback deliberately imports no UI components and uses no icons: the
 * thing that just failed may be one of them. It is plain markup with static
 * classes so it cannot fail for the same reason twice.
 *
 * It claims nothing about the hiker's position. Everything it says is either
 * verifiable from this render or an instruction that is safe when wrong.
 */
export default function NavigateError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Kept to the console only. This screen is used offline, so there is no
    // reporting endpoint to depend on.
    console.error("Navigation screen failed to render", error);
  }, [error]);

  return (
    <main
      role="alert"
      aria-live="assertive"
      className="flex min-h-dvh flex-col justify-between bg-black p-5 text-white"
    >
      <div className="space-y-4 pt-6">
        <h1 className="text-2xl font-bold text-red-400">Navigation display failed</h1>
        <p className="text-base leading-relaxed">
          The moving map stopped working. This is a fault in the app, not a change in
          your route.
        </p>
        <div className="space-y-2 rounded-lg border border-white/25 bg-white/5 p-4">
          <p className="text-base font-semibold">Do this now</p>
          <ol className="list-decimal space-y-2 pl-5 text-base leading-relaxed">
            <li>Stop moving. Do not navigate from memory of the last screen.</li>
            <li>Use your compass and paper backup to confirm where you are.</li>
            <li>Reload the display below. Your saved offline map is not affected.</li>
          </ol>
        </div>
        <p className="text-sm text-white/80">
          Your recorded track and offline route pack are stored on this device and are
          not lost.
        </p>
      </div>

      {/* Placed low so it is reachable one-handed, and sized for gloves. */}
      <div className="space-y-3 pb-2">
        <button
          type="button"
          onClick={reset}
          className="min-h-[56px] w-full rounded-lg bg-white px-6 text-lg font-bold text-black"
        >
          Reload navigation
        </button>
        {/*
          eslint-disable-next-line @next/next/no-html-link-for-pages --
          Deliberate. next/link relies on the client router, which may be exactly
          what failed. A plain anchor performs a full document navigation and
          rebuilds the app from scratch, which is the recovery path we want here.
        */}
        <a
          href="/"
          className="flex min-h-[56px] w-full items-center justify-center rounded-lg border border-white/40 px-6 text-lg font-semibold text-white"
        >
          Back to plans
        </a>
      </div>
    </main>
  );
}
