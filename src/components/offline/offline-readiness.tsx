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
import { InstallOfflineHint } from "@/components/offline/install-offline-hint";

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
    message: diagnostic ?? "Could not save this route for offline use on this device.",
    diagnostic,
  };
}

function formatBytes(value?: number): string {
  if (value === undefined) return "Unavailable";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function CheckRow({
  checkId,
  icon,
  title,
  ok,
  detail,
}: {
  checkId?: string;
  icon: React.ReactNode;
  title: string;
  ok: boolean;
  detail: string;
}) {
  return (
    <li
      className="flex gap-3 rounded-lg border bg-background p-3"
      data-offline-check={checkId}
      data-offline-status={ok ? "ready" : "warning"}
    >
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
        getNavigateOfflineStatus(),
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
                ? "Ready on this device. Test airplane mode before leaving signal."
                : "Finish every item below while you still have a stable connection."}
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
        <InstallOfflineHint />
        <ul className="space-y-2">
          <CheckRow
            checkId="route-pack"
            icon={<Route className="mt-0.5 h-4 w-4" />}
            title={packReady ? "Route saved" : "Route missing — prepare it again while online"}
            ok={packReady}
            detail={
              packReady
                ? "The marked route and its safety information are saved on this device."
                : state.packStatus === "stale"
                  ? "This saved route uses an older safety-data format. Update it while online."
                  : state.packCheckFailed
                    ? "Offline route storage could not be checked. Treat this route as missing; reconnect and re-download it before relying on this device."
                    : "Navigation cannot start without a current saved route. Reconnect and prepare it again."
            }
          />
          <CheckRow
            checkId="corridor-context"
            icon={<Mountain className="mt-0.5 h-4 w-4" />}
            title={
              packReady && state.corridor
                ? state.corridorFeatures
                  ? "Nearby trail and landmark context saved"
                  : "Nearby coverage recorded; context not saved"
                : "Nearby context missing — prepare again while online"
            }
            // The pass mark has to mean what the title says. This row printed a
            // green check beside "context not saved" -- a screen reader read it
            // out as "Nearby coverage recorded; context not saved. Pass." -- the
            // one row in this list where the two disagreed.
            ok={Boolean(packReady && state.corridor && state.corridorFeatures)}
            detail={
              packReady && state.corridor
                ? state.corridorFeatures
                  // Said on the success branch too, not only on the failure one.
                  // "Nearby context saved" reads as "the map is on the phone",
                  // and the thing that is not on the phone -- the shape of the
                  // ground -- is the thing a hiker would most want on it.
                  ? "Nearby trails, roads, water, shelters, campsites, and landmarks are stored. They may be incomplete or out of date, and no terrain tiles are downloaded: there are no contours, shaded relief, or imagery on this map."
                  : "The nearby coverage target is recorded, but nearby details were not saved. Update while online if you want that context."
                : packReady
                  ? "This saved route has no nearby coverage record. Update it while online."
                  : "Save the route to record its nearby coverage target. Shaded terrain and contour tiles are not downloaded yet."
            }
          />
          <CheckRow
            icon={<ShieldAlert className="mt-0.5 h-4 w-4" />}
            title={
              packReady && state.officialAlerts
                ? "Official alerts checked"
                : "Official alerts not checked — update while online"
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
                ? "Route forecast saved"
                : "Route forecast not saved — update while online"
            }
            ok={Boolean(packReady && state.hazardBrief)}
            detail={
              packReady && state.hazardBrief
                ? describeHazardBrief(state.hazardBrief)
                : packReady
                  ? "This saved route has no along-route forecast snapshot. Update it while online, or enter field weather in Safety. Cached weather is not current weather."
                  : "Save the route to store a 24-hour forecast snapshot along it. Navigation still works without that snapshot."
            }
          />
          <CheckRow
            icon={<ScreenShare className="mt-0.5 h-4 w-4" />}
            title={
              state.navigation.ready
                ? "App works offline for this route"
                : state.navigation.filesReady
                  ? "App files saved — reopen the installed app"
                  : state.navigation.shellCached
                    ? "Offline app setup incomplete"
                    : "App not prepared for an offline start"
            }
            ok={state.navigation.ready}
            detail={
              state.navigation.ready
                ? "The app screen and required files are present, and the offline system is active."
                : state.navigation.filesReady
                  ? "The required files are present, but this tab is not using them yet. Close and reopen the installed app, then verify."
                  : state.navigation.expectedAssets > 0
                    ? "Some required app files are missing. Retry Prepare offline on a stable connection."
                    : "The basic route may still be stored, but a first offline open is not verified and may show offline help instead of navigation."
            }
          />
          <CheckRow
            checkId="storage-persistence"
            icon={<HardDriveDownload className="mt-0.5 h-4 w-4" />}
            title="Saved routes less likely to be removed"
            ok={state.persistent}
            detail={
              state.persistent
                ? "The browser granted persistent storage for this app."
                : "The browser may remove saved data when device storage is low. Keep the app installed and recheck before leaving signal."
            }
          />
          <CheckRow
            icon={<HardDriveDownload className="mt-0.5 h-4 w-4" />}
            title="Storage space can be checked"
            ok={state.usage !== undefined}
            detail={spaceDetail}
          />
        </ul>
        <details className="mt-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer font-medium">Technical details</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Route record: {state.packStatus}</li>
            <li>
              App files: {state.navigation.cachedAssets}/{state.navigation.expectedAssets || "?"} verified
            </li>
            <li>Offline worker control: {state.navigation.serviceWorkerControlled ? "active" : "inactive"}</li>
            <li>Storage persistence: {state.persistent ? "granted" : "not granted"}</li>
            {state.corridor && <li>{describePersistedCorridor(state.corridor)}</li>}
            {state.corridorFeatures && <li>{describeCorridorFeatures(state.corridorFeatures)}</li>}
          </ul>
        </details>
      </CardContent>
    </Card>
  );
}
