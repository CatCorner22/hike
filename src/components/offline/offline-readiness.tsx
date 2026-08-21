"use client";

import { useEffect, useState } from "react";
import type React from "react";
import { CheckCircle2, CircleAlert, HardDriveDownload, Mountain, Route, ScreenShare } from "lucide-react";
import {
  getRoutePackStatus,
  type RoutePackStatus,
} from "@/lib/offline/route-pack";
import { isNavigateShellCached } from "@/lib/offline/navigate-shell";
import { isStoragePersistent, storageEstimate } from "@/lib/offline/storage";
import { describePersistedCorridor, type TerrainCorridorSpec } from "@/lib/offline/terrain-corridor";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface ReadinessState {
  packStatus: RoutePackStatus;
  packCheckFailed: boolean;
  shellCached: boolean;
  persistent: boolean;
  usage?: number;
  quota?: number;
  corridor?: TerrainCorridorSpec | null;
}

const EMPTY_READINESS: ReadinessState = {
  packStatus: "missing",
  packCheckFailed: false,
  shellCached: false,
  persistent: false,
  corridor: null,
};

/**
 * Browser errors expose implementation details such as IDB versions and
 * transaction names. The recovery action is what a hiker needs; diagnostics
 * remain available to callers without being presented as the primary message.
 */
export function formatOfflineRouteStorageError(error: unknown): {
  message: string;
  diagnostic?: string;
} {
  const diagnostic = error instanceof Error ? error.message : undefined;
  if (
    (error instanceof DOMException &&
      (error.name === "VersionError" || error.name === "NotFoundError")) ||
    /requested version|failed to execute ['"]transaction['"]|object store/i.test(diagnostic ?? "")
  ) {
    return {
      message: "This device has a newer, incompatible, or damaged saved-route database. Reconnect and re-download this route before relying on this device.",
      diagnostic,
    };
  }
  if (error instanceof DOMException && error.name === "QuotaExceededError") {
    return {
      message: "Offline storage is full. Reconnect, sync or remove recordings, then re-download this route before relying on this device.",
      diagnostic,
    };
  }
  return {
    message: diagnostic ?? "Could not save the route pack on this device.",
    diagnostic,
  };
}

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
    let refreshNumber = 0;
    const refresh = async () => {
      const currentRefresh = ++refreshNumber;
      const [packResult, shellResult, persistentResult, estimateResult] = await Promise.allSettled([
        getRoutePackStatus(packId),
        isNavigateShellCached(packId),
        isStoragePersistent(),
        storageEstimate(),
      ]);
      // Do not let a slower pre-eviction read overwrite a later failed check.
      if (!cancelled && currentRefresh === refreshNumber) {
        const pack = packResult.status === "fulfilled"
          ? packResult.value
          : { status: "missing" as const, pack: null };
        setReadiness({
          packStatus: pack.status,
          packCheckFailed: packResult.status === "rejected",
          shellCached: shellResult.status === "fulfilled" ? shellResult.value : false,
          persistent: persistentResult.status === "fulfilled" ? persistentResult.value : false,
          usage: estimateResult.status === "fulfilled" ? estimateResult.value?.usage : undefined,
          quota: estimateResult.status === "fulfilled" ? estimateResult.value?.quota : undefined,
          corridor: pack.pack?.corridor ?? null,
        });
      }
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };

    void refresh();
    window.addEventListener("hike:offline-readiness-changed", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      cancelled = true;
      window.removeEventListener("hike:offline-readiness-changed", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
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
        <CardDescription>Check these items before leaving signal.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          <CheckRow
            icon={<Route className="mt-0.5 h-4 w-4" />}
            title={packReady ? "Route pack saved" : "Route pack missing — re-download before relying on this device"}
            ok={packReady}
            detail={
              packReady
                ? "Route geometry and safety data are saved on this device."
                : state.packStatus === "stale"
                  ? "This pack is older than the current safety-data format. Refresh it while online."
                  : state.packCheckFailed
                    ? "Offline route storage could not be checked. Treat this route as missing; reconnect and re-download it before relying on this device."
                    : "Navigation cannot start without a saved, current route pack. Reconnect and re-download before relying on this device."
            }
          />
          <CheckRow
            icon={<Mountain className="mt-0.5 h-4 w-4" />}
            title={
              packReady && state.corridor
                ? "Terrain corridor recorded"
                : "Terrain corridor missing — update the pack while online"
            }
            ok={Boolean(packReady && state.corridor)}
            detail={
              packReady && state.corridor
                ? describePersistedCorridor(state.corridor)
                : packReady
                  ? "This pack has no corridor record. Update the offline pack while online to store coverage and the planned download size."
                  : "Save the route pack to record the planned terrain corridor. Terrain tiles themselves are not downloaded yet."
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
