"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { persistRoutePack } from "@/lib/offline/load-route-pack";
import { parseRoutePackBackup, PACK_BACKUP_DISCLAIMER, serializeRoutePackBackup } from "@/lib/offline/pack-backup";
import { listRoutePacks, routePackStatus, type RoutePack } from "@/lib/offline/route-pack";
import { downloadTextFile, safeFilename } from "@/lib/safety/field";

export function OfflineSavedPacks() {
  const [packs, setPacks] = useState<RoutePack[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    const readPacks = () => {
      void listRoutePacks()
        .then((next) => {
          if (!cancelled) setPacks(next);
        })
        .catch(() => {
          if (!cancelled) {
            setPacks([]);
            setMessage("Saved route packs could not be read on this device.");
          }
        });
    };
    readPacks();
    window.addEventListener("hike:offline-readiness-changed", readPacks);
    return () => {
      cancelled = true;
      window.removeEventListener("hike:offline-readiness-changed", readPacks);
    };
  }, []);

  function exportPack(pack: RoutePack) {
    try {
      downloadTextFile(
        `${safeFilename(pack.name)}-klandagi-pack.json`,
        serializeRoutePackBackup(pack),
        "application/json",
      );
      setMessage("Backup downloaded. This is a device file, not cloud sync.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not export this pack.");
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

  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Saved route packs</h2>
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
        <p className="text-sm text-muted-foreground">Checking saved route packs…</p>
      ) : packs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No route packs are saved on this device.</p>
      ) : (
        <ul className="space-y-2">
          {packs.map((pack) => {
            const status = routePackStatus(pack);
            const ready = status === "ready";
            return (
              <li key={pack.id} className="flex items-start justify-between gap-3 rounded-lg bg-muted px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">{pack.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {ready
                      ? "Saved and ready to navigate."
                      : "Saved, but needs an online refresh before relying on it."}
                  </p>
                </div>
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
              </li>
            );
          })}
        </ul>
      )}
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}
