"use client";

import { useMemo, useState } from "react";
import { Copy, LifeBuoy, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { copyEmergencyInfo, emergencyMessage, formatCoords, type PositionSource } from "@/lib/safety/emergency";
import { formatFixAge } from "@/lib/safety/gps-quality";
import { formatDdm, formatMgrs10, formatUsng } from "@/lib/safety/usng";
import type { IceProfile } from "@/lib/safety/profile";

export interface RescueCardProps {
  lat?: number;
  lng?: number;
  accuracyM?: number;
  trailName?: string;
  offTrailM?: number;
  stale?: boolean;
  recordedAt?: number;
  positionSource?: PositionSource;
  profile?: IceProfile | null;
  batteryPct?: number | null;
  batteryCharging?: boolean;
  triggerClassName?: string;
}

/** Large, glanceable rescue coordinates — roadmap P1 Rescue Card. */
export function RescueCard({
  lat,
  lng,
  accuracyM,
  trailName,
  offTrailM,
  stale,
  recordedAt,
  positionSource,
  profile,
  batteryPct,
  batteryCharging,
  triggerClassName,
}: RescueCardProps) {
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);

  const coordsLine = useMemo(() => {
    if (lat == null || lng == null) return "No usable GPS fix";
    return formatCoords(lat, lng, accuracyM);
  }, [lat, lng, accuracyM]);

  const gridLines = useMemo(() => {
    if (lat == null || lng == null) return [] as string[];
    const usng = formatUsng(lat, lng);
    const mgrs = formatMgrs10(lat, lng);
    const ddm = formatDdm(lat, lng);
    return [
      usng ? `USNG: ${usng}` : null,
      mgrs ? `MGRS: ${mgrs}` : null,
      ddm ? `DDM: ${ddm}` : null,
    ].filter((line): line is string => Boolean(line));
  }, [lat, lng]);

  const fixLabel = useMemo(() => {
    switch (positionSource) {
      case "deadReckon":
        return "Dead-reckon estimate — not live GPS";
      case "lastKnown":
        return "Last-known fix — GPS not live";
      default:
        return stale ? "Stale GPS fix" : "Live GPS fix";
    }
  }, [positionSource, stale]);

  const emergencyText = useMemo(
    () =>
      emergencyMessage({
        lat,
        lng,
        accuracyM,
        trailName,
        offTrailM,
        stale,
        recordedAt,
        positionSource,
        profile,
      }),
    [lat, lng, accuracyM, trailName, offTrailM, stale, recordedAt, positionSource, profile],
  );

  async function shareOrCopy() {
    if (navigator.share) {
      try {
        await navigator.share({ title: "Rescue location", text: emergencyText });
        setCopied("ok");
        return;
      } catch {
        /* fall through */
      }
    }
    const ok = await copyEmergencyInfo(emergencyText);
    setCopied(ok ? "ok" : "fail");
    window.setTimeout(() => setCopied(null), 2500);
  }

  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={`min-h-11 gap-1.5 ${triggerClassName ?? ""}`}
            aria-label="Open rescue card with coordinates"
          >
            <LifeBuoy className="h-4 w-4" />
            Rescue
          </Button>
        }
      />
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl">
        <SheetHeader>
          <SheetTitle>Rescue card</SheetTitle>
          <SheetDescription>
            Read aloud or copy. Fix source and age are stated plainly — never implied live when stale.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          <div className="rounded-xl border-2 border-destructive/30 bg-destructive/5 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{fixLabel}</p>
            <p className="mt-1 font-mono text-2xl font-bold tabular-nums leading-tight">{coordsLine}</p>
            {recordedAt != null && Number.isFinite(recordedAt) && (
              <p className="mt-1 text-sm text-muted-foreground">Fix age: {formatFixAge(recordedAt)}</p>
            )}
          </div>
          {gridLines.length > 0 && (
            <ul className="space-y-1 font-mono text-sm tabular-nums">
              {gridLines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          <dl className="grid grid-cols-2 gap-2 text-sm">
            {trailName && (
              <>
                <dt className="text-muted-foreground">Route</dt>
                <dd className="font-medium">{trailName}</dd>
              </>
            )}
            {offTrailM != null && Number.isFinite(offTrailM) && (
              <>
                <dt className="text-muted-foreground">Off trail</dt>
                <dd className="font-medium">{Math.round(offTrailM)} m</dd>
              </>
            )}
            {batteryPct != null && (
              <>
                <dt className="text-muted-foreground">Battery</dt>
                <dd className="font-medium">
                  {Math.round(batteryPct)}%{batteryCharging ? " (charging)" : ""}
                </dd>
              </>
            )}
          </dl>
          <div className="flex flex-wrap gap-2">
            <Button type="button" className="min-h-11 flex-1" onClick={() => void shareOrCopy()}>
              {copied === "ok" ? (
                "Copied"
              ) : copied === "fail" ? (
                "Copy failed"
              ) : (
                <>
                  <Copy className="mr-2 h-4 w-4" />
                  Copy full grid
                </>
              )}
            </Button>
            {typeof navigator !== "undefined" && "share" in navigator && (
              <Button type="button" variant="secondary" className="min-h-11" onClick={() => void shareOrCopy()}>
                <Share2 className="mr-2 h-4 w-4" />
                Share
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
