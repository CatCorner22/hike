"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { playSosTone, vibrateSos } from "@/lib/safety/strobe";

export function SosBeacon({ onClose }: { onClose: () => void }) {
  const [flash, setFlash] = useState(true);

  useEffect(() => {
    const timer = window.setInterval(() => setFlash((v) => !v), 280);
    vibrateSos();
    void playSosTone(3);
    const vibe = window.setInterval(() => vibrateSos(), 4000);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(vibe);
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col items-center justify-center"
      style={{ background: flash ? "#ffffff" : "#000000" }}
      role="alertdialog"
      aria-label="SOS locator beacon"
    >
      <p className={`text-4xl font-black ${flash ? "text-black" : "text-white"}`}>SOS</p>
      <p className={`mt-2 text-sm ${flash ? "text-black" : "text-white"}`}>
        Screen strobe + tone. Use to be seen or heard.
      </p>
      <Button className="mt-8" variant="secondary" onClick={onClose}>
        Stop beacon
      </Button>
    </div>
  );
}
