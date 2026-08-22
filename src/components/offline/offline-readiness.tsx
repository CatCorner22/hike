"use client";

import { useEffect, useState } from "react";
import type React from "react";
import { CheckCircle2, CircleAlert, CloudSun, HardDriveDownload, Mountain, RefreshCw, Route, ScreenShare, ShieldAlert } from "lucide-react";
import {
  getRoutePackStatus,
  type RoutePackStatus,
} from "@/lib/offline/route-pack";
import {
  getNavigateOfflineStatus,
  type NavigateOfflineStatus,
} from "@/lib/offline/navigate-shell";
import { isStoragePersistent, storageEstimate } from "@/lib/offline/storage";
import { describeCorridorFeatures, type CorridorFeatureSet } from "@/lib/offline/corridor-features";
import { describeHazardBrief, type RouteHazardBrief } from "@/lib/offline/hazard-brief";
import { describeOfficialAlertSnapshot, type RouteOfficialAlertSnapshot } from "@/lib/offline/official-alerts";
import { describePersistedCorridor, type TerrainCorridorSpec } from "@/lib/offline/terrain-corridor";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface ReadinessState {
  packStatus: RoutePackStatus;
  packCheckFailed: boolean;
  navigation: NavigateOfflineStatus;
  persistent: boolean;
  usage?: number;
  quota?: number;
  corridor?: TerrainCorridorSpec | null;
  corridorFeatures?: CorridorFeatureSet | null;
  hazardBrief?: RouteHazardBrief | null;
  officialAlerts?: RouteOfficialAlertSnapshot | null;
}

const EMPTY_READINESS: ReadinessState = {
  packStatus: "missing",
  packCheckFailed: false,
  navigation: {
    shellCached: false,
    expectedAssets: 0,
    cachedAssets: 0,
    missingAssets: [],
    serviceWorkerControlled: false,
    filesReady: false,
    ready: false,
  },
  persistent: false,
  corridor: null,
  corridorFeatures: null,
  hazardBrief: null,
  officialAlerts: null,
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
        getNavigateOfflineStatus(packId),
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
          navigation: shellResult.status === "fulfilled" ? shellResult.value : EMPTY_READINESS.navigation,
          persistent: persistentResult.status === "fulfilled" ? persistentResult.value : false,
          usage: estimateResult.status === "fulfilled" ? estimateResult.value?.usage : undefined,
          quota: estimateResult.status === "fulfilled" ? estimateResult.value?.quota : undefined,
          corridor: pack.pack?.corridor ?? null,
          corridorFeatures: pack.pack?.corridorFeatures ?? null,
          hazardBrief: pack.pack?.hazardBrief ?? null,
          officialAlerts: pack.pack?.officialAlerts ?? null,
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
  const tripReady = packReady && state.navigation.ready;
  const spaceDetail =
    state.usage === undefined
      ? "Browser storage reporting is unavailable, so available offline space cannot be confirmed."
      : `${formatBytes(state.usage)} used of approximately ${formatBytes(state.quota)}.`;

  return (
    <Card size="sm" className="mt-3 w-full max-w-xl">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Offline readiness</CardTitle>
            <CardDescription>
              {tripReady
                ? "This route passed the on-device file check. Test airplane mode before leaving signal."
                : "Not fully verified. Basic route data and offline launch are checked separately."}
            </CardDescription>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => window.dispatchEvent(new Event("hike:offline-readiness-changed"))}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Verify
          </Button>
        </div>
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
                ? state.corridorFeatures
                  ? "Offline corridor plan and OSM context recorded"
                  : "Offline corridor plan recorded"
                : "Offline corridor plan missing — update the pack while online"
            }
            ok={Boolean(packReady && state.corridor)}
            detail={
              packReady && state.corridor
                ? `${describePersistedCorridor(state.corridor)}. ${
                  state.corridorFeatures
                    ? describeCorridorFeatures(state.corridorFeatures)
                    : "OSM context is not stored on this pack. Update it while online if you want nearby trails, roads, water, and shelters."
                }`
                : packReady
                  ? "This pack has no corridor record. Update the offline pack while online to store coverage and the planned download size."
                  : "Save the route pack to record the planned corridor. Terrain tiles themselves are not downloaded yet."
            }
          />
          <CheckRow
            icon={<ShieldAlert className="mt-0.5 h-4 w-4" />}
            title={
              packReady && state.officialAlerts
                ? "Official alert check recorded"
                : "Official alert check missing — update the pack while online"
            }
            ok={Boolean(packReady && state.officialAlerts)}
            detail={
              packReady && state.officialAlerts
                ? describeOfficialAlertSnapshot(state.officialAlerts)
                : packReady
                  ? "No NWS/NPS check is stored. That is not evidence that there are no alerts or closures."
                  : "Prepare online to make a point-sampled NWS alert check and, when an exact unit is verified, an NPS notice check."
            }
          />
          <CheckRow
            icon={<CloudSun className="mt-0.5 h-4 w-4" />}
            title={
              packReady && state.hazardBrief
                ? "Route forecast snapshot recorded"
                : "Route forecast snapshot missing — update the pack while online"
            }
            ok={Boolean(packReady && state.hazardBrief)}
            detail={
              packReady && state.hazardBrief
                ? describeHazardBrief(state.hazardBrief)
                : packReady
                  ? "This pack has no along-route forecast snapshot. Update it while online, or enter field weather in Safety. Cached weather is not current weather."
                  : "Save the route pack to store a 24-hour forecast snapshot along the route. Navigation still works without it."
            }
          />
          <CheckRow
            icon={<ScreenShare className="mt-0.5 h-4 w-4" />}
            title={
              state.navigation.ready
                ? "Offline launch files verified"
                : state.navigation.filesReady
                  ? "Files saved — reopen the installed app to activate offline launch"
                  : state.navigation.shellCached
                    ? "Offline launch files incomplete"
                    : "Offline launch not prepared"
            }
            ok={state.navigation.ready}
            detail={
              state.navigation.ready
                ? `${state.navigation.cachedAssets} of ${state.navigation.expectedAssets} versioned app files are present, and this page is controlled by the offline worker.`
                : state.navigation.filesReady
                  ? `${state.navigation.cachedAssets} of ${state.navigation.expectedAssets} app files are present, but this tab is not controlled by the offline worker. Close and reopen the installed app, then verify.`
                  : state.navigation.expectedAssets > 0
                    ? `${state.navigation.cachedAssets} of ${state.navigation.expectedAssets} required app files are present. Retry Prepare offline on a stable connection.`
                    : "The basic route may still be stored, but a first offline open is not verified and may show offline help instead of navigation."
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
