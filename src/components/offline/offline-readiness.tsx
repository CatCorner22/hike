"use client";

import { useEffect, useState } from "react";
import type React from "react";
import { CheckCircle2, CircleAlert, HardDriveDownload, Route, ScreenShare } from "lucide-react";
import {
  getRoutePackStatus,
  type RoutePackStatus,
} from "@/lib/offline/route-pack";
import { isNavigateShellCached } from "@/lib/offline/navigate-shell";
import { isStoragePersistent, storageEstimate } from "@/lib/offline/storage";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface ReadinessState {
  packStatus: RoutePackStatus;
  shellCached: boolean;
  persistent: boolean;
  usage?: number;
  quota?: number;
}

const EMPTY_READINESS: ReadinessState = {
  packStatus: "missing",
  shellCached: false,
  persistent: false,
};

function formatBytes(value?: number): string {
  if (value === undefined) return "Unavailable";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function CheckRow({
  icon,
  title,
  ok,
  detail,
}: {
  icon: React.ReactNode;
  title: string;
  ok: boolean;
  detail: string;
}) {
  return (
    <li className="flex gap-3 rounded-lg border bg-background p-3">
      <span className={ok ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}>
        {icon}
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">{title}</p>
          {ok ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-700 dark:text-emerald-400" aria-label="Pass" />
          ) : (
            <CircleAlert className="h-4 w-4 text-amber-700 dark:text-amber-400" aria-label="Warning" />
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
      </div>
    </li>
  );
}

export function OfflineReadiness({ packId }: { packId: string }) {
  const [readiness, setReadiness] = useState<ReadinessState | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const [pack, shellCached, persistent, estimate] = await Promise.all([
        getRoutePackStatus(packId),
        isNavigateShellCached(packId),
        isStoragePersistent(),
        storageEstimate(),
      ]);
      if (!cancelled) {
        setReadiness({
          packStatus: pack.status,
          shellCached,
          persistent,
          usage: estimate?.usage,
          quota: estimate?.quota,
        });
      }
    };
    void refresh();
    window.addEventListener("hike:offline-readiness-changed", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("hike:offline-readiness-changed", refresh);
    };
  }, [packId]);

  const state = readiness ?? EMPTY_READINESS;
  const packReady = state.packStatus === "ready";
  const spaceDetail =
    state.usage === undefined
      ? "Browser storage reporting is unavailable, so available offline space cannot be confirmed."
      : `${formatBytes(state.usage)} used of approximately ${formatBytes(state.quota)}.`;

  return (
    <Card size="sm" className="mt-3 w-full max-w-xl">
      <CardHeader>
        <CardTitle>Offline readiness</CardTitle>
        <CardDescription>Check all four items before leaving signal.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          <CheckRow
            icon={<Route className="mt-0.5 h-4 w-4" />}
            title="Route pack saved"
            ok={packReady}
            detail={
              packReady
                ? "Route geometry and safety data are saved on this device."
                : state.packStatus === "stale"
                  ? "This pack is older than the current safety-data format. Refresh it while online."
                  : "Navigation cannot start without a saved, current route pack."
            }
          />
          <CheckRow
            icon={<ScreenShare className="mt-0.5 h-4 w-4" />}
            title="Navigate screen cached"
            ok={state.shellCached}
            detail={
              state.shellCached
                ? "The navigation screen and its needed app files are cached for a first offline open."
                : "A first offline open will show the offline help screen instead of navigation."
            }
          />
          <CheckRow
            icon={<HardDriveDownload className="mt-0.5 h-4 w-4" />}
            title="Storage marked persistent"
            ok={state.persistent}
            detail={
              state.persistent
                ? "The browser has marked this app's storage persistent."
                : "The browser may evict this pack under storage pressure. Keep the app installed and open."
            }
          />
          <CheckRow
            icon={<HardDriveDownload className="mt-0.5 h-4 w-4" />}
            title="Approximate space used"
            ok={state.usage !== undefined}
            detail={spaceDetail}
          />
        </ul>
      </CardContent>
    </Card>
  );
}
