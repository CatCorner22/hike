"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Copy,
  Droplets,
  Flag,
  LifeBuoy,
  MessageSquare,
  Share2,
  Siren,
  Sun,
  Timer,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { compassLabel } from "@/lib/geo/navigation";
import { formatWalkBearing } from "@/lib/safety/declination";
import {
  copyEmergencyInfo,
  emergencyMessage,
  formatCoords,
} from "@/lib/safety/emergency";
import { formatFixAge } from "@/lib/safety/gps-quality";
import {
  dropWaypoint,
  getIceProfile,
  getOverdueAlarm,
  listWaypoints,
  overdueStatus,
  saveIceProfile,
  setOverdueAlarm,
  type IceProfile,
  type SafetyWaypoint,
} from "@/lib/safety/profile";
import {
  deadReckon,
  distanceFromPaces,
  formatRangeAzimuth,
  formatZulu,
  rangeAzimuth,
} from "@/lib/safety/landnav";
import { lostProcedure, nineLineMedevac, pacePlan, radioGrid } from "@/lib/safety/medevac";
import { smsHref } from "@/lib/safety/strobe";
import {
  formatDdm,
  formatDms,
  formatMgrs10,
  formatUsng,
  formatUtm,
  parseUsng,
} from "@/lib/safety/usng";

interface SafetyPanelProps {
  lat?: number;
  lng?: number;
  accuracyM?: number;
  trailName: string;
  packId: string;
  offTrailM?: number;
  bearingToTrail?: number;
  bearingToStart?: number;
  daylightWarning?: string | null;
  altitudeM?: number;
  stale?: boolean;
  recordedAt?: number;
  backtrackEnabled: boolean;
  backtrackReady: boolean;
  onToggleBacktrack: () => void;
  onBeacon: () => void;
  onWaypointsChange: (points: SafetyWaypoint[]) => void;
  heading?: number;
  onGoto: (point: { lat: number; lng: number } | null) => void;
}

export function SafetyPanel({
  lat,
  lng,
  accuracyM,
  trailName,
  packId,
  offTrailM,
  bearingToTrail,
  bearingToStart,
  daylightWarning,
  altitudeM,
  stale,
  recordedAt,
  backtrackEnabled,
  backtrackReady,
  onToggleBacktrack,
  onBeacon,
  onWaypointsChange,
  heading,
  onGoto,
}: SafetyPanelProps) {
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);
  const [profile, setProfile] = useState<IceProfile>({
    name: "",
    iceName: "",
    icePhone: "",
    medical: "",
    partySize: 1,
  });
  const [returnLocal, setReturnLocal] = useState("");
  const [overdueLabel, setOverdueLabel] = useState<string | null>(null);
  const [overdue, setOverdue] = useState(false);
  const [gotoGrid, setGotoGrid] = useState("");
  const [gotoInfo, setGotoInfo] = useState<string | null>(null);
  const [paces, setPaces] = useState("65");
  const [paceLen, setPaceLen] = useState("65");
  const [copiedNine, setCopiedNine] = useState(false);

  useEffect(() => {
    void getIceProfile().then(setProfile);
    void getOverdueAlarm().then((alarm) => {
      if (!alarm) return;
      setReturnLocal(toLocalInput(alarm.returnAt));
    });
  }, []);

  useEffect(() => {
    const tick = () => {
      if (!returnLocal) {
        setOverdueLabel(null);
        setOverdue(false);
        return;
      }
      const status = overdueStatus(new Date(returnLocal).toISOString());
      setOverdueLabel(status.label);
      setOverdue(status.overdue);
    };
    tick();
    const id = window.setInterval(tick, 30000);
    return () => window.clearInterval(id);
  }, [returnLocal]);

  const message = useMemo(
    () =>
      emergencyMessage({
        lat,
        lng,
        accuracyM,
        trailName,
        offTrailM,
        stale,
        recordedAt,
        profile,
      }),
    [lat, lng, accuracyM, trailName, offTrailM, stale, recordedAt, profile],
  );

  async function handleCopy() {
    const ok = await copyEmergencyInfo(message);
    setCopied(ok ? "ok" : "fail");
    setTimeout(() => setCopied(null), 2500);
  }

  async function handleShare() {
    if (navigator.share) {
      try {
        await navigator.share({ title: "My hiking location", text: message });
        return;
      } catch {
        /* cancelled */
      }
    }
    await handleCopy();
  }

  async function persistProfile(next: IceProfile) {
    setProfile(next);
    await saveIceProfile(next);
  }

  async function persistReturn(value: string) {
    setReturnLocal(value);
    await setOverdueAlarm(value ? new Date(value) : null);
  }

  async function markWaypoint(kind: SafetyWaypoint["kind"]) {
    if (lat == null || lng == null) return;
    const point = await dropWaypoint(packId, kind, lat, lng);
    onWaypointsChange(await listWaypoints(packId));
    void point;
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
      <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <LifeBuoy className="size-5 text-primary" />
            Safety &amp; SOS
          </SheetTitle>
          <SheetDescription>
            Offline tools for rescue: USNG, ICE card, beacon, backtrack, overdue timer.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4 px-4 pb-6">
          {daylightWarning && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
              <Sun className="mt-0.5 size-4 shrink-0 text-amber-600" />
              <p>{daylightWarning}</p>
            </div>
          )}

          {overdueLabel && (
            <div
              className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
                overdue
                  ? "border-destructive bg-destructive/10 text-destructive"
                  : "border-border"
              }`}
            >
              <Timer className="mt-0.5 size-4 shrink-0" />
              <p>{overdueLabel}</p>
            </div>
          )}

          {offTrailM != null && offTrailM > 35 && !stale && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
              <div>
                <p className="font-medium text-destructive">
                  {Math.round(offTrailM)} m off route
                </p>
                {bearingToTrail != null && (
                  <p className="mt-1 text-muted-foreground">
                    Walk {formatWalkBearing(bearingToTrail, lat, lng)} (
                    {compassLabel(bearingToTrail)}) toward the dashed orange line.
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="rounded-lg border p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {stale ? "Last known position" : "Your position"}
            </p>
            {lat != null && lng != null ? (
              <>
                <p className="mt-1 font-mono text-sm">{formatCoords(lat, lng, accuracyM)}</p>
                <p className="mt-1 font-mono text-xs">USNG {formatUsng(lat, lng)}</p>
                <p className="font-mono text-xs">MGRS10 {formatMgrs10(lat, lng)}</p>
                <p className="font-mono text-xs text-muted-foreground">{formatDdm(lat, lng)}</p>
                <p className="font-mono text-xs text-muted-foreground">{formatDms(lat, lng)}</p>
                <p className="font-mono text-xs text-muted-foreground">{formatUtm(lat, lng)}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{radioGrid(lat, lng).split("\n")[1]}</p>
                <p className="text-[11px] text-muted-foreground">Zulu {formatZulu()}</p>
                {recordedAt != null && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    GPS fix {formatFixAge(recordedAt)}
                    {stale ? " — not a live location" : ""}
                  </p>
                )}
                {altitudeM != null && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Altitude ~{Math.round(altitudeM * 3.28084).toLocaleString()} ft
                  </p>
                )}
                {bearingToStart != null && !stale && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Trailhead: {formatWalkBearing(bearingToStart, lat, lng)} (
                    {compassLabel(bearingToStart)})
                  </p>
                )}
              </>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">
                No GPS fix yet. The downloaded trail stays on the map.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button onClick={() => void handleCopy()} variant="outline">
              <Copy className="mr-2 size-4" />
              {copied === "ok" ? "Copied" : copied === "fail" ? "Copy failed" : "Copy"}
            </Button>
            <Button onClick={() => void handleShare()} variant="outline">
              <Share2 className="mr-2 size-4" />
              Share
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                window.location.href = smsHref(profile.icePhone, message);
              }}
            >
              <MessageSquare className="mr-2 size-4" />
              SMS ICE
            </Button>
            <Button variant="destructive" onClick={onBeacon}>
              <Siren className="mr-2 size-4" />
              Beacon
            </Button>
            <Button
              variant={backtrackEnabled ? "default" : "outline"}
              disabled={!backtrackReady}
              onClick={onToggleBacktrack}
            >
              <Undo2 className="mr-2 size-4" />
              {backtrackEnabled ? "Exit backtrack" : "Backtrack"}
            </Button>
            <Button
              variant="outline"
              disabled={lat == null}
              onClick={() => void markWaypoint("water")}
            >
              <Droplets className="mr-2 size-4" />
              Mark water
            </Button>
            <Button
              variant="outline"
              disabled={lat == null}
              onClick={() => void markWaypoint("junction")}
            >
              <Flag className="mr-2 size-4" />
              Mark junction
            </Button>
            <Button
              variant="outline"
              disabled={lat == null}
              onClick={() => void markWaypoint("lkp")}
            >
              Mark LKP
            </Button>
            <Button
              variant="outline"
              disabled={lat == null}
              onClick={() => void markWaypoint("rp")}
            >
              Mark RP
            </Button>
          </div>

          <div className="rounded-lg border p-3 space-y-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Field nav — go-to grid
            </p>
            <Input
              value={gotoGrid}
              placeholder="11S MJ 1234 5678"
              onChange={(e) => setGotoGrid(e.target.value)}
            />
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  const parsed = parseUsng(
                    gotoGrid,
                    lat != null && lng != null ? { lat, lng } : undefined,
                  );
                  if (!parsed) {
                    setGotoInfo("Could not parse that USNG/MGRS grid.");
                    return;
                  }
                  onGoto(parsed);
                  if (lat != null && lng != null) {
                    setGotoInfo(formatRangeAzimuth(rangeAzimuth({ lat, lng }, parsed)));
                  } else {
                    setGotoInfo("Grid plotted. Waiting for GPS for range/azimuth.");
                  }
                }}
              >
                Plot go-to
              </Button>
              <Button variant="ghost" onClick={() => { onGoto(null); setGotoInfo(null); }}>
                Clear
              </Button>
            </div>
            {gotoInfo && <p className="text-xs text-muted-foreground">{gotoInfo}</p>}
            {lat != null && lng != null && heading != null && (
              <p className="text-xs text-muted-foreground">
                Current heading {Math.round(heading)}° true. Dead-reckon{" "}
                {Math.round(distanceFromPaces(Number(paces) || 0, Number(paceLen) || 65))} m
                on that heading with the pace boxes below.
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="paces">Paces</Label>
                <Input id="paces" value={paces} onChange={(e) => setPaces(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="pace-len">Paces / 100 m</Label>
                <Input id="pace-len" value={paceLen} onChange={(e) => setPaceLen(e.target.value)} />
              </div>
            </div>
            <Button
              variant="outline"
              disabled={lat == null || heading == null}
              onClick={() => {
                if (lat == null || lng == null || heading == null) return;
                const dest = deadReckon(
                  { lat, lng },
                  heading,
                  distanceFromPaces(Number(paces) || 0, Number(paceLen) || 65),
                );
                onGoto(dest);
                setGotoInfo(
                  formatRangeAzimuth(rangeAzimuth({ lat, lng }, dest)) + " (dead reckon)",
                );
              }}
            >
              Dead reckon
            </Button>
          </div>

          <div className="rounded-lg border p-3 space-y-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              9-line / lost procedure
            </p>
            <Button
              variant="outline"
              onClick={async () => {
                const ok = await copyEmergencyInfo(
                  nineLineMedevac({
                    lat,
                    lng,
                    trailName,
                    profile,
                  }),
                );
                setCopiedNine(ok);
                setTimeout(() => setCopiedNine(false), 2000);
              }}
            >
              <Copy className="mr-2 size-4" />
              {copiedNine ? "9-line copied" : "Copy 9-line MEDEVAC"}
            </Button>
            <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
              {lostProcedure().map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {pacePlan().map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>

          <div className="rounded-lg border p-3 space-y-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Planned return
            </p>
            <Input
              type="datetime-local"
              value={returnLocal}
              onChange={(e) => void persistReturn(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Stored on this phone. When time passes, navigation shows OVERDUE.
            </p>
          </div>

          <div className="rounded-lg border p-3 space-y-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              ICE / medical (on device)
            </p>
            <Label htmlFor="hiker-name">Your name</Label>
            <Input
              id="hiker-name"
              value={profile.name}
              onChange={(e) => void persistProfile({ ...profile, name: e.target.value })}
            />
            <Label htmlFor="ice-name">Emergency contact</Label>
            <Input
              id="ice-name"
              value={profile.iceName}
              onChange={(e) => void persistProfile({ ...profile, iceName: e.target.value })}
            />
            <Label htmlFor="ice-phone">Contact phone</Label>
            <Input
              id="ice-phone"
              type="tel"
              value={profile.icePhone}
              onChange={(e) => void persistProfile({ ...profile, icePhone: e.target.value })}
            />
            <Label htmlFor="party">Party size</Label>
            <Input
              id="party"
              type="number"
              min={1}
              value={profile.partySize}
              onChange={(e) =>
                void persistProfile({
                  ...profile,
                  partySize: Math.max(1, Number(e.target.value) || 1),
                })
              }
            />
            <Label htmlFor="medical">Medical notes</Label>
            <Input
              id="medical"
              value={profile.medical}
              placeholder="Allergies, meds, conditions"
              onChange={(e) => void persistProfile({ ...profile, medical: e.target.value })}
            />
          </div>

          <div className="rounded-lg border p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">Tell 911 / SAR</p>
            <p>1. USNG grid (above) — preferred in the U.S.</p>
            <p>2. Injuries, party size, last seen time</p>
            <p>3. Route name and whether you can stay put</p>
            <p>
              Route: {trailName}. GPS can be wrong in canyons — confirm with terrain.
            </p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
