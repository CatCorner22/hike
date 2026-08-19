"use client";

import { useState } from "react";
import { AlertTriangle, Copy, LifeBuoy, Share2, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { compassLabel } from "@/lib/geo/navigation";
import {
  copyEmergencyInfo,
  emergencyMessage,
  formatCoords,
} from "@/lib/safety/emergency";

interface SafetyPanelProps {
  lat: number;
  lng: number;
  accuracyM?: number;
  trailName: string;
  offTrailM?: number;
  bearingToTrail?: number;
  bearingToStart?: number;
  daylightWarning?: string | null;
  altitudeM?: number;
}

export function SafetyPanel({
  lat,
  lng,
  accuracyM,
  trailName,
  offTrailM,
  bearingToTrail,
  bearingToStart,
  daylightWarning,
  altitudeM,
}: SafetyPanelProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const ok = await copyEmergencyInfo(
      emergencyMessage({
        lat,
        lng,
        accuracyM,
        trailName,
        offTrailM,
      }),
    );
    setCopied(ok);
    if (ok) setTimeout(() => setCopied(false), 2500);
  }

  async function handleShare() {
    const text = emergencyMessage({
      lat,
      lng,
      accuracyM,
      trailName,
      offTrailM,
    });
    if (navigator.share) {
      try {
        await navigator.share({ title: "My hiking location", text });
        return;
      } catch {
        /* user cancelled */
      }
    }
    await handleCopy();
  }

  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button variant="secondary" size="icon-sm" aria-label="Safety and SOS" />
        }
      >
        <LifeBuoy className="size-4" />
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <LifeBuoy className="size-5 text-primary" />
            Safety &amp; SOS
          </SheetTitle>
          <SheetDescription>
            Works offline. Share your coordinates with rescuers if needed.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {daylightWarning && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
              <Sun className="mt-0.5 size-4 shrink-0 text-amber-600" />
              <p>{daylightWarning}</p>
            </div>
          )}

          {offTrailM != null && offTrailM > 35 && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
              <div>
                <p className="font-medium text-destructive">
                  {Math.round(offTrailM)} m off route
                </p>
                {bearingToTrail != null && (
                  <p className="mt-1 text-muted-foreground">
                    Walk {Math.round(bearingToTrail)}° ({compassLabel(bearingToTrail)}) toward
                    the dashed orange line on the map.
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="rounded-lg border p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Your position</p>
            <p className="mt-1 font-mono text-sm">{formatCoords(lat, lng, accuracyM)}</p>
            {altitudeM != null && (
              <p className="mt-1 text-sm text-muted-foreground">
                Altitude ~{Math.round(altitudeM * 3.28084).toLocaleString()} ft
              </p>
            )}
            {bearingToStart != null && (
              <p className="mt-2 text-sm text-muted-foreground">
                Trailhead bearing: {Math.round(bearingToStart)}° ({compassLabel(bearingToStart)})
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void handleCopy()} variant="outline" className="flex-1">
              <Copy className="mr-2 size-4" />
              {copied ? "Copied" : "Copy coords"}
            </Button>
            <Button onClick={() => void handleShare()} className="flex-1">
              <Share2 className="mr-2 size-4" />
              Share location
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            Route: {trailName}. GPS can be wrong in canyons — use the green trail line and terrain
            features to confirm your position.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
