"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { playSosTone, vibrateSos } from "@/lib/safety/strobe";

/**
 * Whether this device has asked for reduced motion. Read once at mount rather
 * than subscribed to: a rescue screen that changed behaviour underneath someone
 * mid-signal would be worse than one that is merely a setting behind.
 */
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function SosBeacon({ onClose }: { onClose: () => void }) {
  const [flash, setFlash] = useState(true);
  // The strobe alternates at 280 ms, which is 1.8 flashes per second — under the
  // three-per-second threshold, but a full-screen black-and-white alternation is
  // still exactly what someone turns reduced motion on to avoid. So it does not
  // start on its own for them; the tone does, and one deliberate tap adds the
  // flashing when being seen matters more.
  const [strobing, setStrobing] = useState(() => !prefersReducedMotion());

  useEffect(() => {
    const abort = new AbortController();
    vibrateSos();
    void playSosTone("loop", abort.signal);
    const vibe = window.setInterval(() => vibrateSos(), 4000);
    return () => {
      abort.abort();
      window.clearInterval(vibe);
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        // Web-only cancel of an in-flight vibration; native impacts are
        // discrete taps with nothing to cancel.
        navigator.vibrate(0);
      }
    };
  }, []);

  useEffect(() => {
    if (!strobing) return;
    const timer = window.setInterval(() => setFlash((v) => !v), 280);
    return () => window.clearInterval(timer);
  }, [strobing]);

  const onLight = strobing && flash;
  const text = onLight ? "text-black" : "text-white";

  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col items-center justify-center"
      style={{ background: onLight ? "#ffffff" : "#000000" }}
      role="alertdialog"
      aria-label="Sound & flash locator"
    >
      <p className={`text-4xl font-black ${text}`}>SOS</p>
      <p className={`mt-2 text-lg font-bold ${text}`}>Sound &amp; flash locator</p>
      <p className={`mt-3 max-w-sm px-6 text-center text-base font-black ${text}`}>
        Does not contact 911, SAR, or transmit your location.
      </p>
      <p className={`mt-3 max-w-sm px-6 text-center text-sm ${text}`}>
        {strobing ? "Screen strobe + looping tone." : "Looping tone, screen held steady."} Use to be
        seen or heard. Stop cancels the sound. Keep the screen on — the beacon stops if the phone
        locks.
      </p>
      <div className="mt-8 flex w-full max-w-sm flex-col gap-3 px-6">
        {!strobing && (
          <Button
            className="h-14 w-full border-2 border-black bg-white text-base font-bold text-black hover:bg-neutral-200"
            onClick={() => setStrobing(true)}
          >
            Start the screen flashing
          </Button>
        )}
        {/*
          The Stop control sat on a background alternating between white and
          black, in the app's secondary grey — 1.09:1 against the light frame,
          which is to say invisible half the time, on the one screen where the
          way out has to be findable in a panic. It now carries its own colour
          and a double outline, so it reads against either frame.
        */}
        <Button
          className="h-14 w-full border-2 border-white bg-red-700 text-base font-bold text-white shadow-[0_0_0_2px_#000] hover:bg-red-800"
          onClick={onClose}
        >
          Stop sound &amp; flash
        </Button>
      </div>
    </div>
  );
}
