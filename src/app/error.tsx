"use client";

import { useEffect } from "react";

/**
 * App-wide error boundary. Uses plain markup and no UI imports so it cannot fail
 * for the same reason as the tree it is replacing. The navigate route has its
 * own, more specific fallback.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Page failed to render", error);
  }, [error]);

  return (
    <main role="alert" aria-live="assertive" className="mx-auto max-w-lg space-y-5 p-6">
      <h1 className="text-2xl font-bold">This page failed to load</h1>
      <p className="text-base leading-relaxed">
        Something in the app broke while drawing this page. Your plans, recorded tracks
        and saved offline maps are stored separately and are not affected.
      </p>
      <p className="text-base leading-relaxed">
        If you are already on the trail, stop and confirm your position with your compass
        and paper backup before continuing.
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={reset}
          className="min-h-[48px] rounded-lg bg-foreground px-6 text-base font-semibold text-background"
        >
          Try again
        </button>
        {/*
          eslint-disable-next-line @next/next/no-html-link-for-pages --
          Deliberate. next/link relies on the client router, which may be exactly
          what failed. A plain anchor performs a full document navigation and
          rebuilds the app from scratch, which is the recovery path we want here.
        */}
        <a
          href="/"
          className="flex min-h-[48px] items-center justify-center rounded-lg border px-6 text-base font-semibold"
        >
          Back to plans
        </a>
      </div>
    </main>
  );
}
