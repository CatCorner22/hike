"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  Droplets,
  Flag,
  LifeBuoy,
  Megaphone,
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
import { moonPhase } from "@/lib/safety/astro";
import {
  formatWalkBearing,
  gmAngleCard,
  magneticDeclination,
  toTrueBearing,
} from "@/lib/safety/declination";
import {
  copyEmergencyInfo,
  emergencyMessage,
  formatCoords,
} from "@/lib/safety/emergency";
import {
  breadcrumbGpx,
  downloadTextFile,
  isIceFilled,
  nearestWaypoint,
  safeFilename,
  safetySelfCheck,
} from "@/lib/safety/field";
import { formatFixAge } from "@/lib/safety/gps-quality";
import { isWakeLockHeld } from "@/lib/offline/wake-lock";
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
  courseCorrection,
  deadReckon,
  deliberateOffset,
  distanceFromPaces,
  formatRangeAzimuth,
  formatZulu,
  milRelationRange,
  obstacleBox,
  rangeAzimuth,
  resection,
  type PaceTerrain,
} from "@/lib/safety/landnav";
import { lostProcedure, nineLineMedevac, pacePlan, radioGrid } from "@/lib/safety/medevac";
import { closeNavLeg, formatNavLog, listNavLegs, startNavLeg, type NavLeg } from "@/lib/safety/navlog";
import {
  groundToAirSignals,
  imsafeWarning,
  marchCard,
  mistReport,
  sarFrequencies,
  sitrep,
  type ImsafeFlag,
} from "@/lib/safety/reports";
import {
  sereAssessment,
  serePriorities,
  sereQuickCard,
  sereRuleOfThrees,
  sereSections,
  sereShelterChecklist,
  sereSignalingMethods,
  sereWaterGuidance,
  type SerePillar,
} from "@/lib/safety/sere";
import { playWhistleBlasts, smsHref } from "@/lib/safety/strobe";
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
  waypoints?: SafetyWaypoint[];
  trackPoints?: Array<{ lat: number; lng: number; altitude?: number; recordedAt: string }>;
  onDrank?: () => void;
  gpsTrusted?: boolean;
  gpsDenied?: boolean;
  onToggleGpsDenied?: () => void;
  onDeniedPaces?: (paces: number) => void;
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
  waypoints = [],
  trackPoints = [],
  onDrank,
  gpsTrusted = false,
  gpsDenied = false,
  onToggleGpsDenied,
  onDeniedPaces,
}: SafetyPanelProps) {
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);
  const [profile, setProfile] = useState<IceProfile>({
    name: "",
    iceName: "",
    icePhone: "",
    medical: "",
    partySize: 1,
    bloodType: "",
  });
  const [returnLocal, setReturnLocal] = useState("");
  const [overdueLabel, setOverdueLabel] = useState<string | null>(null);
  const [overdue, setOverdue] = useState(false);
  const [gotoGrid, setGotoGrid] = useState("");
  const [gotoInfo, setGotoInfo] = useState<string | null>(null);
  const [paces, setPaces] = useState("65");
  const [paceLen, setPaceLen] = useState("65");
  const [copiedNine, setCopiedNine] = useState(false);
  const [gpxStatus, setGpxStatus] = useState<string | null>(null);
  const [whistleBusy, setWhistleBusy] = useState(false);
  const [terrain, setTerrain] = useState<PaceTerrain>("flat");
  const [gridA, setGridA] = useState("");
  const [brgA, setBrgA] = useState("");
  const [gridB, setGridB] = useState("");
  const [brgB, setBrgB] = useState("");
  const [bearingsMag, setBearingsMag] = useState(true);
  const [offsetM, setOffsetM] = useState("100");
  const [offsetSide, setOffsetSide] = useState<"left" | "right">("right");
  const [boxW, setBoxW] = useState("40");
  const [boxD, setBoxD] = useState("80");
  const [heightM, setHeightM] = useState("1.8");
  const [mils, setMils] = useState("10");
  const [legs, setLegs] = useState<NavLeg[]>([]);
  const [copiedReport, setCopiedReport] = useState<string | null>(null);
  const [imsafe, setImsafe] = useState<ImsafeFlag[]>([]);
  const [resectInfo, setResectInfo] = useState<string | null>(null);
  const [copiedSere, setCopiedSere] = useState(false);
  const [sereOpen, setSereOpen] = useState<SerePillar | "all">("survival");
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const profileRef = useRef(profile);
  profileRef.current = profile;

  useEffect(() => {
    void getIceProfile().then(setProfile);
    void getOverdueAlarm().then((alarm) => {
      if (!alarm) return;
      setReturnLocal(toLocalInput(alarm.returnAt));
    });
    return () => {
      if (persistTimer.current) {
        clearTimeout(persistTimer.current);
        void saveIceProfile(profileRef.current);
      }
    };
  }, []);

  useEffect(() => {
    void listNavLegs(packId).then(setLegs);
  }, [packId]);

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

  function persistProfile(next: IceProfile) {
    setProfile(next);
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      persistTimer.current = null;
      void saveIceProfile(next);
    }, 400);
  }

  const nearest = useMemo(
    () => (lat != null && lng != null ? nearestWaypoint({ lat, lng }, waypoints) : null),
    [lat, lng, waypoints],
  );

  const checks = useMemo(
    () =>
      safetySelfCheck({
        packReady: true,
        gpsTrusted,
        iceFilled: isIceFilled(profile),
        returnSet: Boolean(returnLocal),
        wakeLock: isWakeLockHeld(),
        crumbs: trackPoints.length,
        gpsDenied,
      }),
    [gpsTrusted, profile, returnLocal, trackPoints.length, gpsDenied],
  );

  const moon = useMemo(() => moonPhase(), []);
  const gm = lat != null && lng != null ? gmAngleCard(lat, lng) : null;
  const imsafeNote = imsafeWarning(imsafe);
  const isDark = Boolean(daylightWarning?.match(/dark|sunset|headlamp|polar night/i));
  const sereNote = sereAssessment({
    isDark,
    altitudeM,
    partySize: profile.partySize,
    hasSignal: gpsTrusted,
  });
  const sereSectionsList = useMemo(() => sereSections(), []);

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
            Land-nav and rescue: resection, GPS-denied DR, SITREP, MARCH, USNG, ICE.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4 px-4 pb-6">
          {daylightWarning && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
              <Sun className="mt-0.5 size-4 shrink-0 text-amber-600" />
              <p>{daylightWarning}</p>
            </div>
          )}

          {imsafeNote && (
            <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
              {imsafeNote}
            </div>
          )}

          {gm && (
            <p className="text-xs text-muted-foreground">
              {gm.gridToMagnetic}. {gm.magneticToGrid}. {moon.nightNav}
            </p>
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
                {nearest && (
                  <p className="mt-2 text-xs text-muted-foreground">{nearest.label}</p>
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
            <Button
              variant="outline"
              disabled={lat == null}
              onClick={() => void markWaypoint("ap")}
            >
              Mark AP
            </Button>
            <Button
              variant="outline"
              disabled={lat == null}
              onClick={() => void markWaypoint("cf")}
            >
              Mark CF
            </Button>
            <Button
              variant="outline"
              disabled={lat == null}
              onClick={() => void markWaypoint("hr")}
            >
              Mark handrail
            </Button>
            <Button
              variant={gpsDenied ? "default" : "outline"}
              disabled={!gpsDenied && !gpsTrusted}
              onClick={() => onToggleGpsDenied?.()}
            >
              {gpsDenied ? "Exit GPS denied" : "GPS denied"}
            </Button>
            <Button
              variant="outline"
              disabled={trackPoints.length < 2}
              onClick={async () => {
                const gpx = breadcrumbGpx(`${trailName} breadcrumbs`, trackPoints);
                try {
                  downloadTextFile(`${safeFilename(trailName)}-track.gpx`, gpx);
                  setGpxStatus("GPX downloaded");
                } catch {
                  const ok = await copyEmergencyInfo(gpx);
                  setGpxStatus(ok ? "GPX copied" : "GPX export failed");
                }
                window.setTimeout(() => setGpxStatus(null), 2500);
              }}
            >
              <Download className="mr-2 size-4" />
              {gpxStatus ?? "Export GPX"}
            </Button>
            <Button
              variant="outline"
              disabled={whistleBusy}
              onClick={() => {
                setWhistleBusy(true);
                void playWhistleBlasts(3).finally(() => setWhistleBusy(false));
              }}
            >
              <Megaphone className="mr-2 size-4" />
              {whistleBusy ? "Whistle…" : "3-blast whistle"}
            </Button>
            <Button variant="outline" onClick={() => onDrank?.()}>
              <Droplets className="mr-2 size-4" />
              I drank
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
                {Math.round(distanceFromPaces(Number(paces) || 0, Number(paceLen) || 65, terrain))} m
                on that heading with the pace boxes below.
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="paces">Paces</Label>
                <Input
                  id="paces"
                  value={paces}
                  onChange={(e) => {
                    setPaces(e.target.value);
                    onDeniedPaces?.(Number(e.target.value) || 0);
                  }}
                />
              </div>
              <div>
                <Label htmlFor="pace-len">Paces / 100 m</Label>
                <Input id="pace-len" value={paceLen} onChange={(e) => setPaceLen(e.target.value)} />
              </div>
            </div>
            <div>
              <Label htmlFor="terrain">Terrain factor</Label>
              <select
                id="terrain"
                className="h-9 w-full rounded-lg border bg-background px-2 text-sm"
                value={terrain}
                onChange={(e) => setTerrain(e.target.value as PaceTerrain)}
              >
                <option value="flat">Flat</option>
                <option value="up">Upslope</option>
                <option value="down">Downslope</option>
                <option value="sand">Sand</option>
                <option value="snow">Snow</option>
                <option value="night">Night</option>
                <option value="brush">Brush</option>
              </select>
            </div>
            <Button
              variant="outline"
              disabled={lat == null || heading == null}
              onClick={() => {
                if (lat == null || lng == null || heading == null) return;
                const dest = deadReckon(
                  { lat, lng },
                  heading,
                  distanceFromPaces(Number(paces) || 0, Number(paceLen) || 65, terrain),
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
              Resection / offset / box / mils
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Input value={gridA} placeholder="Known A grid" onChange={(e) => setGridA(e.target.value)} />
              <Input value={brgA} placeholder="Bearing to A" onChange={(e) => setBrgA(e.target.value)} />
              <Input value={gridB} placeholder="Known B grid" onChange={(e) => setGridB(e.target.value)} />
              <Input value={brgB} placeholder="Bearing to B" onChange={(e) => setBrgB(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={bearingsMag}
                onChange={(e) => setBearingsMag(e.target.checked)}
              />
              Bearings are magnetic
            </label>
            <Button
              variant="outline"
              onClick={() => {
                const hint = lat != null && lng != null ? { lat, lng } : undefined;
                const a = parseUsng(gridA, hint);
                const b = parseUsng(gridB, hint);
                if (!a || !b) {
                  setResectInfo("Need two valid USNG/MGRS points.");
                  return;
                }
                let azA = Number(brgA);
                let azB = Number(brgB);
                if (!Number.isFinite(azA) || !Number.isFinite(azB)) {
                  setResectInfo("Bearings must be numbers.");
                  return;
                }
                if (bearingsMag && lat != null && lng != null) {
                  const dec = magneticDeclination(lat, lng);
                  if (dec != null) {
                    azA = toTrueBearing(azA, dec);
                    azB = toTrueBearing(azB, dec);
                  }
                }
                const fix = resection(a, azA, b, azB);
                if (!fix) {
                  setResectInfo("No cut — check bearings and that the rays cross.");
                  return;
                }
                onGoto(fix.point);
                setResectInfo(
                  `Resection ${formatUsng(fix.point.lat, fix.point.lng)} · cut ${Math.round(fix.cutDeg)}°${fix.warning ? ` — ${fix.warning}` : ""}`,
                );
              }}
            >
              Plot resection
            </Button>
            {resectInfo && <p className="text-xs text-muted-foreground">{resectInfo}</p>}
            <div className="grid grid-cols-2 gap-2">
              <Input value={offsetM} onChange={(e) => setOffsetM(e.target.value)} placeholder="Offset m" />
              <select
                className="h-9 rounded-lg border bg-background px-2 text-sm"
                value={offsetSide}
                onChange={(e) => setOffsetSide(e.target.value as "left" | "right")}
              >
                <option value="right">Offset right</option>
                <option value="left">Offset left</option>
              </select>
            </div>
            <Button
              variant="outline"
              disabled={lat == null || !gotoGrid}
              onClick={() => {
                if (lat == null || lng == null) return;
                const dest = parseUsng(gotoGrid, { lat, lng });
                if (!dest) {
                  setGotoInfo("Plot or type a go-to grid first.");
                  return;
                }
                const off = deliberateOffset(
                  { lat, lng },
                  dest,
                  Number(offsetM) || 0,
                  offsetSide,
                );
                onGoto(off.aim);
                setGotoInfo(off.label);
              }}
            >
              Aim-off go-to
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Input value={boxW} onChange={(e) => setBoxW(e.target.value)} placeholder="Box width m" />
              <Input value={boxD} onChange={(e) => setBoxD(e.target.value)} placeholder="Box depth m" />
            </div>
            <Button
              variant="outline"
              disabled={lat == null || heading == null}
              onClick={() => {
                if (lat == null || lng == null || heading == null) return;
                const box = obstacleBox(
                  { lat, lng },
                  heading,
                  Number(boxW) || 0,
                  Number(boxD) || 0,
                  offsetSide,
                );
                onGoto(box.resume);
                setGotoInfo(
                  `Box resume ${formatRangeAzimuth(rangeAzimuth({ lat, lng }, box.resume))}. Then continue original heading.`,
                );
              }}
            >
              Obstacle box
            </Button>
            {offTrailM != null && offTrailM > 15 && (
              <p className="text-xs text-muted-foreground">
                Drift {Math.round(offTrailM)} m. To close that over 200 m, turn ~
                {Math.round(Math.abs(courseCorrection(offTrailM, 200)))}° toward the dashed
                trail line.
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Input value={heightM} onChange={(e) => setHeightM(e.target.value)} placeholder="Landmark height m" />
              <Input value={mils} onChange={(e) => setMils(e.target.value)} placeholder="Mils subtended" />
            </div>
            <p className="text-xs text-muted-foreground">
              Landmark range:{" "}
              {milRelationRange(Number(heightM) || 0, Number(mils) || 0)?.toFixed(0) ?? "—"} m
              (height × 1000 / mils). Person ~1.8 m.
            </p>
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
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={async () => {
                  const ok = await copyEmergencyInfo(
                    sitrep({ lat, lng, trailName, profile, stale }),
                  );
                  setCopiedReport(ok ? "SITREP copied" : "Copy failed");
                  window.setTimeout(() => setCopiedReport(null), 2000);
                }}
              >
                <Copy className="mr-2 size-4" />
                Copy SITREP
              </Button>
              <Button
                variant="outline"
                onClick={async () => {
                  const ok = await copyEmergencyInfo(
                    mistReport({
                      mechanism: "wilderness — see medical notes",
                      injuries: profile.medical || "not stated",
                      lat,
                      lng,
                    }),
                  );
                  setCopiedReport(ok ? "MIST copied" : "Copy failed");
                  window.setTimeout(() => setCopiedReport(null), 2000);
                }}
              >
                Copy MIST
              </Button>
              <Button
                variant="outline"
                onClick={async () => {
                  const ok = await copyEmergencyInfo(formatNavLog(legs));
                  setCopiedReport(ok ? "Nav log copied" : "Copy failed");
                  window.setTimeout(() => setCopiedReport(null), 2000);
                }}
              >
                Copy nav log
              </Button>
            </div>
            {copiedReport && <p className="text-xs text-muted-foreground">{copiedReport}</p>}
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={heading == null}
                onClick={async () => {
                  if (heading == null) return;
                  await startNavLeg(packId, {
                    azimuthTrue: heading,
                    distanceM: distanceFromPaces(Number(paces) || 0, Number(paceLen) || 65, terrain),
                    paces: Number(paces) || undefined,
                    terrain,
                    fromLat: lat,
                    fromLng: lng,
                    note: gotoGrid || undefined,
                  });
                  setLegs(await listNavLegs(packId));
                }}
              >
                Start leg
              </Button>
              <Button
                variant="outline"
                disabled={!legs.some((l) => !l.arrivedAt)}
                onClick={async () => {
                  const open = [...legs].reverse().find((l) => !l.arrivedAt);
                  if (!open) return;
                  await closeNavLeg(open.id);
                  setLegs(await listNavLegs(packId));
                }}
              >
                Close leg
              </Button>
            </div>
            {legs.length > 0 && (
              <p className="whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">
                {formatNavLog(legs)}
              </p>
            )}
            <p className="text-xs font-medium text-foreground">MARCH</p>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {marchCard().map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="text-xs font-medium text-foreground">Ground-to-air</p>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {groundToAirSignals().map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="text-xs font-medium text-foreground">SAR comms (reference)</p>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {sarFrequencies().map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="text-xs font-medium text-foreground">IMSAFE</p>
            <div className="flex flex-wrap gap-2 text-xs">
              {(
                [
                  ["illness", "Illness"],
                  ["meds", "Meds"],
                  ["stress", "Stress"],
                  ["alcohol", "Alcohol"],
                  ["fatigue", "Fatigue"],
                  ["emotion", "Emotion"],
                ] as Array<[ImsafeFlag, string]>
              ).map(([id, label]) => (
                <label key={id} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={imsafe.includes(id)}
                    onChange={(e) =>
                      setImsafe((prev) =>
                        e.target.checked ? [...prev, id] : prev.filter((x) => x !== id),
                      )
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          {sereNote && (
            <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
              {sereNote}
            </div>
          )}

          <div className="rounded-lg border p-3 space-y-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              SERE — survival · evasion · recovery · escape
            </p>
            <p className="text-xs text-muted-foreground">
              Civilian backcountry SERE: stay alive, reduce risk, keep your head, self-rescue only
              when you know the way.
            </p>
            <div className="flex flex-wrap gap-1">
              {(["survival", "evasion", "recovery", "escape"] as SerePillar[]).map((p) => (
                <Button
                  key={p}
                  size="sm"
                  variant={sereOpen === p ? "default" : "outline"}
                  onClick={() => setSereOpen(p)}
                >
                  {p}
                </Button>
              ))}
            </div>
            <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
              {sereSectionsList
                .find((s) => s.pillar === sereOpen)
                ?.bullets.map((line) => <li key={line}>{line}</li>)}
            </ul>
            <p className="text-xs font-medium text-foreground">Rule of threes</p>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {sereRuleOfThrees().map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="text-xs font-medium text-foreground">
              Priorities {isDark ? "(night / cold)" : "(day)"}
            </p>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {serePriorities(isDark).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer font-medium text-foreground">Shelter · water · signal</summary>
              <p className="mt-2 font-medium text-foreground">Shelter</p>
              <ul className="list-disc pl-4">
                {sereShelterChecklist().map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
              <p className="mt-2 font-medium text-foreground">Water</p>
              <ul className="list-disc pl-4">
                {sereWaterGuidance().map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
              <p className="mt-2 font-medium text-foreground">Signal</p>
              <ul className="list-disc pl-4">
                {sereSignalingMethods().map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </details>
            <Button
              variant="outline"
              onClick={async () => {
                const ok = await copyEmergencyInfo(
                  sereQuickCard({ lat, lng, isDark }),
                );
                setCopiedSere(ok);
                window.setTimeout(() => setCopiedSere(false), 2500);
              }}
            >
              <Copy className="mr-2 size-4" />
              {copiedSere ? "SERE card copied" : "Copy full SERE card"}
            </Button>
          </div>

          <div className="rounded-lg border p-3 space-y-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Offline self-check
            </p>
            <ul className="space-y-1 text-xs">
              {checks.map((item) => (
                <li
                  key={item.id}
                  className={item.ok ? "text-muted-foreground" : "text-amber-700 dark:text-amber-400"}
                >
                  <CheckCircle2
                    className={`mr-1 inline size-3 ${item.ok ? "text-primary" : "opacity-40"}`}
                  />
                  {item.label}
                </li>
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
            <Label htmlFor="blood">Blood type</Label>
            <Input
              id="blood"
              value={profile.bloodType ?? ""}
              placeholder="O+, A−, unknown"
              onChange={(e) => void persistProfile({ ...profile, bloodType: e.target.value })}
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
