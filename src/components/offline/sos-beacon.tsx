"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { playSosTone, vibrateSos } from "@/lib/safety/strobe";

export function SosBeacon({ onClose }: { onClose: () => void }) {
  const [flash, setFlash] = useState(true);

  useEffect(() => {
    const abort = new AbortController();
    const timer = window.setInterval(() => setFlash((v) => !v), 280);
    vibrateSos();
    void playSosTone("loop", abort.signal);
    const vibe = window.setInterval(() => vibrateSos(), 4000);
    return () => {
      abort.abort();
      window.clearInterval(timer);
      window.clearInterval(vibe);
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        // Web-only cancel of an in-flight vibration; native impacts are
        // discrete taps with nothing to cancel.
        navigator.vibrate(0);
      }
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col items-center justify-center"
      style={{ background: flash ? "#ffffff" : "#000000" }}
      role="alertdialog"
      aria-label="Sound & flash locator"
    >
      <p className={`text-4xl font-black ${flash ? "text-black" : "text-white"}`}>SOS</p>
      <p className={`mt-2 text-lg font-bold ${flash ? "text-black" : "text-white"}`}>
        Sound &amp; flash locator
      </p>
      <p
        className={`mt-3 max-w-sm px-6 text-center text-base font-black ${flash ? "text-black" : "text-white"}`}
      >
        Does not contact 911, SAR, or transmit your location.
      </p>
      <p className={`mt-3 max-w-sm px-6 text-center text-sm ${flash ? "text-black" : "text-white"}`}>
        Screen strobe + looping tone. Use to be seen or heard. Stop cancels the sound.
        Keep the screen on — the beacon stops if the phone locks.
      </p>
      <Button className="mt-8" variant="secondary" onClick={onClose}>
        Stop sound &amp; flash
      </Button>
    </div>
  );
}
