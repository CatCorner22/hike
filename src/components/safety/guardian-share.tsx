"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { copyEmergencyInfo } from "@/lib/safety/emergency";
import { downloadTextFile, safeFilename } from "@/lib/safety/field";
import type { IceProfile } from "@/lib/safety/profile";
import { formatLeaveBehindCard } from "@/lib/safety/leave-behind";
import {
  formatGuardianMessage,
  guardianSmsHref,
  type GuardianMessageKind,
} from "@/lib/safety/guardian-message";
import type { PositionSource } from "@/lib/safety/emergency";

type GuardianShareProps = {
  trailName: string;
  profile: IceProfile;
  returnAt?: string | null;
  geometry?: GeoJSON.LineString | GeoJSON.MultiLineString | null;
  lat?: number;
  lng?: number;
  accuracyM?: number;
  offTrailM?: number;
  batteryPct?: number | null;
  positionSource?: PositionSource;
  lastUpdateAt?: number | string | null;
  compact?: boolean;
};

function printPlain(title: string, body: string) {
  const popup = window.open("", "_blank", "noopener,noreferrer,width=720,height=900");
  if (!popup) return false;
  const escaped = body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  popup.document.write(
    `<!doctype html><html><head><title>${title.replace(/</g, "")}</title><meta charset="utf-8"></head><body style="font:14px/1.45 ui-monospace,monospace;padding:24px;white-space:pre-wrap">${escaped}</body></html>`,
  );
  popup.document.close();
  popup.focus();
  popup.print();
  return true;
}

export function GuardianShare({
  trailName,
  profile,
  returnAt,
  geometry,
  lat,
  lng,
  accuracyM,
  offTrailM,
  batteryPct,
  positionSource,
  lastUpdateAt,
  compact = false,
}: GuardianShareProps) {
  const [status, setStatus] = useState<string | null>(null);

  function flash(message: string) {
    setStatus(message);
    window.setTimeout(() => setStatus(null), 2500);
  }

  async function handOff(text: string, filename: string, preferSms: boolean) {
    if (preferSms) {
      const href = guardianSmsHref(profile.icePhone, text);
      if (href) {
        window.location.href = href;
        flash("Opening messages");
        return;
      }
    }
    const ok = await copyEmergencyInfo(text);
    if (!ok) downloadTextFile(filename, text, "text/plain");
    flash(ok ? "Copied" : "Downloaded");
  }

  function message(kind: GuardianMessageKind) {
    return formatGuardianMessage({
      kind,
      trailName,
      profile,
      returnAt,
      lat,
      lng,
      accuracyM,
      offTrailM,
      batteryPct,
      positionSource,
      lastUpdateAt,
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          className={compact ? "min-h-11" : undefined}
          onClick={async () => {
            const text = formatLeaveBehindCard({ trailName, profile, returnAt, geometry });
            const printed = printPlain(`${trailName} leave-behind`, text);
            if (!printed) {
              await handOff(text, `${safeFilename(trailName)}-leave-behind.txt`, false);
            } else {
              flash("Print dialog opened");
            }
          }}
        >
          Print leave-behind
        </Button>
        <Button
          type="button"
          variant="outline"
          className={compact ? "min-h-11" : undefined}
          onClick={() => void handOff(message("departing"), `${safeFilename(trailName)}-guardian.txt`, true)}
        >
          Text: departing
        </Button>
        <Button
          type="button"
          variant="outline"
          className={compact ? "min-h-11" : undefined}
          onClick={() => void handOff(message("ok"), `${safeFilename(trailName)}-guardian.txt`, true)}
        >
          Text: I&apos;m OK
        </Button>
        <Button
          type="button"
          variant="secondary"
          className={compact ? "min-h-11" : undefined}
          onClick={() => void handOff(message("overdue"), `${safeFilename(trailName)}-guardian.txt`, true)}
        >
          Text: overdue notice
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {status ??
          "Leave-behind is for the fridge or glovebox. Guardian texts never claim that silence means distress."}
      </p>
    </div>
  );
}
