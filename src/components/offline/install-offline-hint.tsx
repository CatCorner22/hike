"use client";

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  detectInstallPlatform,
  manualInstallSteps,
  type InstallPlatform,
} from "@/lib/offline/install-guidance";

const DISMISS_KEY = "klandagi:install-offline-hint-dismissed";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isInstalled(): boolean {
  if (typeof window === "undefined") return false;
  const iosNavigator = navigator as Navigator & { standalone?: boolean };
  return Boolean(
    window.matchMedia("(display-mode: standalone)").matches || iosNavigator.standalone,
  );
}

export function InstallOfflineHint() {
  const [visible, setVisible] = useState(false);
  const [platform, setPlatform] = useState<InstallPlatform>("desktop");
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    const beforeInstall = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
    };
    const installed = () => setVisible(false);
    window.addEventListener("beforeinstallprompt", beforeInstall);
    window.addEventListener("appinstalled", installed);

    // Initialize after hydration so the server and first client render stay identical.
    // The timeout callback is also an external-system notification rather than a
    // synchronous state cascade inside the effect body.
    const initialize = window.setTimeout(() => {
      if (isInstalled()) return;
      try {
        if (localStorage.getItem(DISMISS_KEY) === "yes") return;
      } catch {
        // A blocked localStorage must not hide useful installation guidance.
      }
      setPlatform(detectInstallPlatform(navigator.userAgent, navigator.maxTouchPoints));
      setVisible(true);
    }, 0);

    return () => {
      window.clearTimeout(initialize);
      window.removeEventListener("beforeinstallprompt", beforeInstall);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);

  if (!visible) return null;

  return (
    <aside className="mb-3 rounded-lg border border-emerald-600/30 bg-emerald-50 p-3 text-sm dark:bg-emerald-950/20">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">Install for more reliable offline use</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Recommended, not required. Installation helps the browser retain and reopen the app,
            but you must still prepare and test each route offline.
          </p>
          {!promptEvent && (
            <p className="mt-2 text-xs">{manualInstallSteps(platform)}</p>
          )}
        </div>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Dismiss install guidance"
          onClick={() => {
            setVisible(false);
            try { localStorage.setItem(DISMISS_KEY, "yes"); } catch { /* dismissal lasts this view */ }
          }}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      {promptEvent && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-3"
          onClick={async () => {
            await promptEvent.prompt();
            const choice = await promptEvent.userChoice;
            setPromptEvent(null);
            if (choice.outcome === "accepted") setVisible(false);
          }}
        >
          <Download className="mr-2 h-4 w-4" />Install app
        </Button>
      )}
    </aside>
  );
}
