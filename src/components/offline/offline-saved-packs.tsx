"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Download, Loader2, MapPinned, RefreshCw, Trash2, Upload, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { persistRoutePack } from "@/lib/offline/load-route-pack";
import { parseRoutePackBackup, PACK_BACKUP_DISCLAIMER, serializeRoutePackBackup } from "@/lib/offline/pack-backup";
import { deleteRoutePack, listRoutePacks, routePackStatus, type RoutePack } from "@/lib/offline/route-pack";
import {
  getNavigateOfflineStatus,
  warmNavigateShell,
  type NavigateOfflineStatus,
} from "@/lib/offline/navigate-shell";
import { downloadTextFile, safeFilename } from "@/lib/safety/field";
import { savedPackLaunchCopy, savedPackLaunchState } from "@/lib/offline/saved-pack-readiness";
import { navigateHref } from "@/lib/routes";

export function OfflineSavedPacks() {
  const [packs, setPacks] = useState<RoutePack[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [repairingId, setRepairingId] = useState<string | null>(null);
  const [navigation, setNavigation] = useState<Record<string, NavigateOfflineStatus | null>>({});
  const [online, setOnline] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    const readPacks = () => {
      void listRoutePacks()
        .then(async (next) => {
          if (cancelled) return;
          setPacks(next);
          setNavigation(Object.fromEntries(next.map((pack) => [pack.id, null])));
          // The navigate shell is app-level and shared: one status answers for
          // every pack. Per-pack readiness is the route pack row itself.
          const shellStatus = await getNavigateOfflineStatus();
          if (!cancelled) setNavigation(Object.fromEntries(next.map((pack) => [pack.id, shellStatus])));
        })
        .catch(() => {
          if (!cancelled) {
            setPacks([]);
            setMessage("Saved routes could not be read on this device.");
          }
        });
    };
    const updateOnline = () => setOnline(navigator.onLine);
    updateOnline();
    readPacks();
    window.addEventListener("hike:offline-readiness-changed", readPacks);
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      cancelled = true;
      window.removeEventListener("hike:offline-readiness-changed", readPacks);
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, []);

  async function finishSetup(pack: RoutePack) {
    if (!online || repairingId !== null) return;
    setRepairingId(pack.id);
    setMessage(null);
    try {
      const result = await warmNavigateShell();
      const status = await getNavigateOfflineStatus();
      setNavigation((current) => ({ ...current, [pack.id]: status }));
      setMessage(result.ok
        ? `“${pack.name}” is ready offline.`
        : result.error ?? `“${pack.name}” could not finish offline setup.`);
      window.dispatchEvent(new Event("hike:offline-readiness-changed"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Offline setup could not be completed.");
    } finally {
      setRepairingId(null);
    }
  }

  function exportPack(pack: RoutePack) {
    try {
      downloadTextFile(
        `${safeFilename(pack.name)}-klandagi-pack.json`,
        serializeRoutePackBackup(pack),
        "application/json",
      );
      setMessage("Backup downloaded. This is a device file, not cloud sync.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not export this saved route.");
    }
  }

  async function importFile(file: File) {
    try {
      const parsed = parseRoutePackBackup(await file.text());
      if ("error" in parsed) {
        setMessage(parsed.error);
        return;
      }
      await persistRoutePack(parsed.pack);
      setPacks(await listRoutePacks());
      window.dispatchEvent(new Event("hike:offline-readiness-changed"));
      setMessage(`Imported “${parsed.pack.name}”. Verify Offline readiness before leaving signal.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not import this backup.");
    }
  }

  async function removePack(pack: RoutePack) {
    setDeletingId(pack.id);
    try {
      const deleted = await deleteRoutePack(pack.id);
      // The navigate shell stays: it is shared app UI, and deleting it here
      // would silently break offline launch for every OTHER saved route.
      setPacks(await listRoutePacks());
      setConfirmDeleteId(null);
      window.dispatchEvent(new Event("hike:offline-readiness-changed"));
      setMessage(deleted
        ? `Removed “${pack.name}” from this device.`
        : `“${pack.name}” was already absent from this device.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not remove this saved route.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Saved routes</h2>
        <div>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void importFile(file);
            }}
          />
          <Button type="button" size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
            <Upload className="mr-2 h-4 w-4" />
            Import backup
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{PACK_BACKUP_DISCLAIMER}</p>
      {packs === null ? (
        <p className="text-sm text-muted-foreground">Checking saved routes…</p>
      ) : packs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No routes are saved on this device.</p>
      ) : (
        <ul className="space-y-2">
          {packs.map((pack) => {
            const status = routePackStatus(pack);
            const navStatus = navigation[pack.id];
            const launchState = savedPackLaunchState(status, navStatus);
            const launchCopy = savedPackLaunchCopy(launchState);
            const ready = launchState === "ready";
            return (
              <li key={pack.id} className="space-y-3 rounded-lg bg-muted px-3 py-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">{pack.name}</p>
                  <p className={`text-sm font-medium ${ready ? "text-green-700 dark:text-green-400" : ""}`}>
                    {launchCopy.label}
                  </p>
                  <p className="text-xs text-muted-foreground">{launchCopy.detail}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {ready && (
                    <Link
                      href={navigateHref(pack.id)}
                      className={buttonVariants({ size: "sm" })}
                    >
                      <MapPinned className="mr-2 h-4 w-4" />
                      Start
                    </Link>
                  )}
                  {launchState === "finish-setup" && (
                    <Button
                      type="button"
                      size="sm"
                      variant="default"
                      disabled={!online || repairingId !== null}
                      onClick={() => void finishSetup(pack)}
                    >
                      {repairingId === pack.id ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="mr-2 h-4 w-4" />
                      )}
                      {!online
                        ? "Reconnect to finish"
                        : repairingId === pack.id
                          ? "Checking…"
                          : "Finish setup"}
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={!ready}
                    onClick={() => exportPack(pack)}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Export
                  </Button>
                  {confirmDeleteId === pack.id ? (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        disabled={deletingId === pack.id}
                        onClick={() => void removePack(pack)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        {deletingId === pack.id ? "Removing…" : "Confirm remove"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={deletingId === pack.id}
                        onClick={() => setConfirmDeleteId(null)}
                      >
                        <X className="mr-2 h-4 w-4" />
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmDeleteId(pack.id)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Remove
                    </Button>
                  )}
                </div>
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">Technical details</summary>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    <li>Route record: {status === "ready" ? "current" : status}</li>
                    <li>
                      Offline app files: {navStatus == null
                        ? "checking"
                        : `${navStatus.cachedAssets}/${navStatus.expectedAssets || "?"} verified`}
                    </li>
                    <li>
                      Offline control: {navStatus?.serviceWorkerControlled ? "active" : "not active on this page"}
                    </li>
                  </ul>
                </details>
              </li>
            );
          })}
        </ul>
      )}
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}
