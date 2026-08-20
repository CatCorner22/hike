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
import { CapabilityTabs } from "@/components/safety/capability-tabs";
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
import { breadcrumbGpx, downloadTextFile, isIceFilled, nearestWaypoint, safeFilename, safetySelfCheck } from "@/lib/safety/field";
import { gainLastHourM } from "@/lib/safety/backtrack";
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
  formatTsd,
  formatZulu,
  intersection,
  milRelationRange,
  obstacleBox,
  rangeAzimuth,
  resection,
  resection3,
  timeSpeedDistance,
  type PaceTerrain,
} from "@/lib/safety/landnav";
import { formatRouteCard, routeCardLegs } from "@/lib/safety/route-card";
import {
  aceReport,
  fieldMetar,
  leapfrogSop,
  rallySop,
  smeacBrief,
} from "@/lib/safety/briefs";
import { sunCompassHint } from "@/lib/safety/astro";
import {
  formatNaismith,
  heatWarning,
  lightningRule,
  naismithMinutes,
  windChillWarning,
} from "@/lib/safety/field-ops";
import {
  creepingLineLegs,
  expandingSquareLegs,
  formatSearchPlan,
  parallelTrackLegs,
  searchLineFromLegs,
  sectorSearchLegs,
} from "@/lib/safety/search";
import {
  commsWindowReminder,
  fiveLineHeloBrief,
  litterEvacTime,
  lzAssessmentChecklist,
  saluteReport,
} from "@/lib/safety/sar-advanced";
import { slopeFromProfile, slopeWarning } from "@/lib/safety/field-ops";
import {
  casevacDecision,
  formatGmtCard,
  fordSop,
  lostPersonQuery,
  nightMovementSop,
  paceBeads,
  polarisHint,
  sunVsWatchCheck,
} from "@/lib/safety/tactics";
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
  CHECKIN_INTERVALS,
  checkinStatus,
  formatCheckinLog,
  getCheckinSettings,
  listCheckins,
  logCheckin,
  saveCheckinSettings,
  type CheckinEntry,
  type CheckinSettings,
} from "@/lib/safety/checkin";
import { buildSafetyDossier } from "@/lib/safety/dossier";
import { verifyRegroup } from "@/lib/safety/verify";
import {
  amsAssessment,
  avalancheTerrainWarning,
  bearSafetyCard,
  snakeBiteSop,
  wildernessFirstAidCard,
  wildlifeEncounterSop,
  type AmsSymptom,
  type WildlifeAnimal,
} from "@/lib/safety/wilderness";
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
  geometry?: GeoJSON.LineString | GeoJSON.MultiLineString;
  remainingMeters?: number;
  remainingGainM?: number;
  traveledMeters?: number;
  elevationProfile?: Array<{ distanceMeters: number; elevation: number }>;
  onSearchOverlay?: (line: GeoJSON.LineString | null) => void;
  onCommsAttempt?: () => void;
  lastCommsAt?: number | null;
  onCheckinLogged?: () => void;
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
  geometry,
  remainingMeters,
  remainingGainM,
  traveledMeters,
  elevationProfile = [],
  onSearchOverlay,
  onCommsAttempt,
  lastCommsAt = null,
  onCheckinLogged,
}: SafetyPanelProps) {
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);
  const [profile, setProfile] = useState<IceProfile>({
    name: "",
    iceName: "",
    icePhone: "",
    medical: "",
    partySize: 1,
    bloodType: "",
    challenge: "",
    password: "",
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
  const [gridC, setGridC] = useState("");
  const [brgC, setBrgC] = useState("");
  const [tsdDist, setTsdDist] = useState("");
  const [tsdSpeed, setTsdSpeed] = useState("4");
  const [tsdMin, setTsdMin] = useState("");
  const [flashSec, setFlashSec] = useState("30");
  const [tempC, setTempC] = useState("5");
  const [windKph, setWindKph] = useState("20");
  const [rh, setRh] = useState("40");
  const [waterL, setWaterL] = useState("2");
  const [injured, setInjured] = useState("0");
  const [searchKind, setSearchKind] = useState<"square" | "sector" | "creep" | "parallel">("square");
  const [searchLeg, setSearchLeg] = useState("100");
  const [opsNote, setOpsNote] = useState<string | null>(null);
  const [beads, setBeads] = useState(0);
  const [lpqSeen, setLpqSeen] = useState("");
  const [lpqClothes, setLpqClothes] = useState("");
  const [canWalk, setCanWalk] = useState(true);
  const [checkinSettings, setCheckinSettings] = useState<CheckinSettings>({
    intervalMin: 60,
    enabled: false,
  });
  const [checkins, setCheckins] = useState<CheckinEntry[]>([]);
  const [checkinLabel, setCheckinLabel] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [wildlifeAnimal, setWildlifeAnimal] = useState<WildlifeAnimal>("bear_grizzly");
  const [amsSymptoms, setAmsSymptoms] = useState<AmsSymptom[]>([]);
  const [verifyChallengeIn, setVerifyChallengeIn] = useState("");
  const [verifyPasswordIn, setVerifyPasswordIn] = useState("");
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);
  const [dossierStatus, setDossierStatus] = useState<string | null>(null);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const profileRef = useRef(profile);

  // Mirror the latest profile into a ref so the unmount cleanup below can flush
  // a pending debounced save. Syncing in an effect rather than during render
  // keeps this off the render path.
  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

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
    void getCheckinSettings().then(setCheckinSettings);
    void listCheckins(packId).then(setCheckins);
  }, [packId]);

  useEffect(() => {
    const tick = () => {
      const last = checkins[0]?.recordedAt ?? null;
      setCheckinLabel(checkinStatus(last, checkinSettings)?.label ?? null);
    };
    tick();
    const id = window.setInterval(tick, 30000);
    return () => window.clearInterval(id);
  }, [checkins, checkinSettings]);

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
  const slopePct = useMemo(
    () => slopeFromProfile(elevationProfile, traveledMeters ?? 0),
    [elevationProfile, traveledMeters],
  );
  const commsNote = commsWindowReminder(lastCommsAt);
  const gmt =
    lat != null && lng != null && heading != null
      ? formatGmtCard(heading, null, lat, lng)
      : null;
  const watchHint =
    lat != null && lng != null
      ? sunVsWatchCheck(new Date(), lat, lng, new Date().getHours())
      : null;
  const evac = casevacDecision({
    injured: (Number(injured) || 0) > 0,
    canWalk,
    isDark,
    remainingM: remainingMeters,
    partySize: profile.partySize,
  });
  const beadsInfo = paceBeads(beads);
  const amsResult = amsAssessment({
    altitudeM,
    gainLastHourM: gainLastHourM(trackPoints),
    symptoms: amsSymptoms,
  });
  const avyNote =
    slopePct != null ? avalancheTerrainWarning({ slopePct, aspectDeg: heading }) : null;

  async function persistCheckinSettings(next: CheckinSettings) {
    setCheckinSettings(next);
    await saveCheckinSettings(next);
  }

  async function persistReturn(value: string) {
    setReturnLocal(value);
    await setOverdueAlarm(value ? new Date(value) : null);
  }

  async function markWaypoint(kind: SafetyWaypoint["kind"], note?: string) {
    if (lat == null || lng == null) return;
    await dropWaypoint(packId, kind, lat, lng, note);
    onWaypointsChange(await listWaypoints(packId));
  }

  async function handleCheckin() {
    const entry = await logCheckin(packId, {
      lat,
      lng,
      note: checkinSettings.enabled ? "I'm OK" : undefined,
    });
    setCheckins((prev) => [entry, ...prev].slice(0, 20));
    setCheckinLabel(checkinStatus(entry.recordedAt, checkinSettings)?.label ?? null);
    onCheckinLogged?.();
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

          {commsNote && (
            <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
              {commsNote}
            </div>
          )}

          {slopePct != null && slopeWarning(slopePct) && (
            <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
              {slopeWarning(slopePct)}
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

          {checkinLabel && (
            <div
              className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
                checkinLabel.includes("OVERDUE")
                  ? "border-destructive bg-destructive/10 text-destructive"
                  : "border-amber-500/50 bg-amber-500/10"
              }`}
            >
              <Timer className="mt-0.5 size-4 shrink-0" />
              <p>{checkinLabel}</p>
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
            <Button variant="outline" disabled={lat == null} onClick={() => void handleCheckin()}>
              <CheckCircle2 className="mr-2 size-4" />
              I'm OK
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                onCommsAttempt?.();
                setOpsNote("Comms attempt logged. Try SMS / share / 911 on the next ridge.");
              }}
            >
              Log comms try
            </Button>
            <Button variant="outline" onClick={() => setBeads((n) => n + 1)}>
              Pace bead +100 m
            </Button>
            <Button variant="ghost" onClick={() => setBeads(0)}>
              Reset beads
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                const text = buildSafetyDossier({
                  profile,
                  trailName,
                  packId,
                  lat,
                  lng,
                  accuracyM,
                  stale,
                  recordedAt,
                  offTrailM,
                  returnAt: returnLocal ? new Date(returnLocal).toISOString() : null,
                  checkins,
                  navLegs: legs,
                  waypoints,
                });
                const ok = await copyEmergencyInfo(text);
                if (!ok) {
                  downloadTextFile(`${safeFilename(trailName)}-dossier.txt`, text, "text/plain");
                  setDossierStatus("Dossier downloaded");
                } else {
                  setDossierStatus("Dossier copied");
                }
                window.setTimeout(() => setDossierStatus(null), 2500);
              }}
            >
              <Download className="mr-2 size-4" />
              {dossierStatus ?? "Safety dossier"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Pace beads: {beadsInfo.label}
            {gmt ? ` · ${gmt}` : ""}
            {dossierStatus ? ` · ${dossierStatus}` : ""}
          </p>

          <div className="rounded-lg border p-3 space-y-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Periodic check-in
            </p>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={checkinSettings.enabled}
                onChange={(e) =>
                  void persistCheckinSettings({ ...checkinSettings, enabled: e.target.checked })
                }
              />
              Remind me to check in on schedule
            </label>
            <div className="flex flex-wrap gap-1">
              {CHECKIN_INTERVALS.map((min) => (
                <Button
                  key={min}
                  size="sm"
                  variant={checkinSettings.intervalMin === min ? "default" : "outline"}
                  onClick={() =>
                    void persistCheckinSettings({ ...checkinSettings, intervalMin: min })
                  }
                >
                  {min} min
                </Button>
              ))}
            </div>
            <Button variant="outline" disabled={lat == null} onClick={() => void handleCheckin()}>
              Log I'm OK now
            </Button>
            {checkins.length > 0 && (
              <p className="whitespace-pre-wrap font-mono text-[10px] text-muted-foreground">
                {formatCheckinLog(checkins.slice(0, 5))}
              </p>
            )}
          </div>

          <div className="rounded-lg border p-3 space-y-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Field note</p>
            <Input
              value={noteText}
              placeholder="Landmark, hazard, or rally point note"
              onChange={(e) => setNoteText(e.target.value)}
            />
            <Button
              variant="outline"
              disabled={lat == null || !noteText.trim()}
              onClick={async () => {
                await markWaypoint("note", noteText.trim());
                setNoteText("");
              }}
            >
              Drop note waypoint
            </Button>
          </div>

          <div className="rounded-lg border p-3 space-y-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Wilderness hazards
            </p>
            {avyNote && (
              <p className="text-xs text-amber-700 dark:text-amber-400">{avyNote}</p>
            )}
            <p className="text-xs font-medium text-foreground">Altitude illness (self-report)</p>
            <div className="flex flex-wrap gap-2 text-xs">
              {(
                [
                  ["headache", "Headache"],
                  ["nausea", "Nausea"],
                  ["fatigue", "Fatigue"],
                  ["dizziness", "Dizzy"],
                  ["insomnia", "Insomnia"],
                  ["ataxia", "Unsteady gait"],
                ] as Array<[AmsSymptom, string]>
              ).map(([id, label]) => (
                <label key={id} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={amsSymptoms.includes(id)}
                    onChange={(e) =>
                      setAmsSymptoms((prev) =>
                        e.target.checked ? [...prev, id] : prev.filter((x) => x !== id),
                      )
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
            {amsResult.warning && (
              <p className="text-xs text-amber-700 dark:text-amber-400">{amsResult.warning}</p>
            )}
            {amsResult.actions.length > 0 && (
              <ul className="list-disc pl-4 text-xs text-muted-foreground">
                {amsResult.actions.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer font-medium text-foreground">Bear &amp; wildlife</summary>
              <div className="mt-2 flex flex-wrap gap-1">
                {(
                  [
                    ["bear_grizzly", "Grizzly"],
                    ["bear_black", "Black bear"],
                    ["moose", "Moose"],
                    ["cougar", "Cougar"],
                  ] as Array<[WildlifeAnimal, string]>
                ).map(([id, label]) => (
                  <Button
                    key={id}
                    size="sm"
                    variant={wildlifeAnimal === id ? "default" : "outline"}
                    onClick={() => setWildlifeAnimal(id)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              <ul className="mt-2 list-disc pl-4">
                {wildlifeEncounterSop(wildlifeAnimal).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <p className="mt-2 font-medium text-foreground">Food / bear basics</p>
              <ul className="list-disc pl-4">
                {bearSafetyCard().slice(0, 4).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </details>
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer font-medium text-foreground">
                Snake bite &amp; first aid
              </summary>
              <ul className="mt-2 list-disc pl-4">
                {snakeBiteSop().map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <ul className="mt-2 list-disc pl-4">
                {wildernessFirstAidCard().slice(0, 5).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </details>
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
            <div className="grid grid-cols-2 gap-2">
              <Input value={gridC} placeholder="Known C (3-pt)" onChange={(e) => setGridC(e.target.value)} />
              <Input value={brgC} placeholder="Bearing to C" onChange={(e) => setBrgC(e.target.value)} />
            </div>
            <Button
              variant="outline"
              onClick={() => {
                const hint = lat != null && lng != null ? { lat, lng } : undefined;
                const a = parseUsng(gridA, hint);
                const b = parseUsng(gridB, hint);
                const c = parseUsng(gridC, hint);
                if (!a || !b || !c) {
                  setResectInfo("Need three valid USNG/MGRS points for 3-pt.");
                  return;
                }
                const toTrue = (raw: string) => {
                  let az = Number(raw);
                  if (!Number.isFinite(az)) return null;
                  if (bearingsMag && lat != null && lng != null) {
                    const dec = magneticDeclination(lat, lng);
                    if (dec != null) az = toTrueBearing(az, dec);
                  }
                  return az;
                };
                const azA = toTrue(brgA);
                const azB = toTrue(brgB);
                const azC = toTrue(brgC);
                if (azA == null || azB == null || azC == null) {
                  setResectInfo("All three bearings must be numbers.");
                  return;
                }
                const fix = resection3([
                  { known: a, bearingTo: azA },
                  { known: b, bearingTo: azB },
                  { known: c, bearingTo: azC },
                ]);
                if (!fix) {
                  setResectInfo("No 3-pt cut.");
                  return;
                }
                onGoto(fix.point);
                setResectInfo(
                  `3-pt ${formatUsng(fix.point.lat, fix.point.lng)} · spread ${Math.round(fix.spreadM)} m${fix.warning ? ` — ${fix.warning}` : ""}`,
                );
              }}
            >
              3-pt resection
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const hint = lat != null && lng != null ? { lat, lng } : undefined;
                const a = parseUsng(gridA, hint);
                const b = parseUsng(gridB, hint);
                if (!a || !b) {
                  setResectInfo("Intersection needs two observer grids (A/B) and bearings toward the unknown.");
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
                const hit = intersection(a, azA, b, azB);
                if (!hit) {
                  setResectInfo("No intersection — rays do not cross.");
                  return;
                }
                onGoto(hit.point);
                setResectInfo(
                  `Intersection ${formatUsng(hit.point.lat, hit.point.lng)} · cut ${Math.round(hit.cutDeg)}°${hit.warning ? ` — ${hit.warning}` : ""}`,
                );
              }}
            >
              Intersection (unknown)
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
              Field ops — TSD, SAR search, SMEAC, weather
            </p>
            {lat != null && lng != null && (
              <p className="text-xs text-muted-foreground">{sunCompassHint(new Date(), lat, lng)}</p>
            )}
            {remainingMeters != null && remainingMeters > 0 && (
              <p className="text-xs text-muted-foreground">
                {formatNaismith(naismithMinutes(remainingMeters, remainingGainM ?? 0))} remaining
                (5 km/h + climb).
              </p>
            )}
            <div className="grid grid-cols-3 gap-2">
              <Input value={tsdDist} placeholder="m" onChange={(e) => setTsdDist(e.target.value)} />
              <Input value={tsdSpeed} placeholder="km/h" onChange={(e) => setTsdSpeed(e.target.value)} />
              <Input value={tsdMin} placeholder="min" onChange={(e) => setTsdMin(e.target.value)} />
            </div>
            <Button
              variant="outline"
              onClick={() => {
                const tsd = timeSpeedDistance({
                  distanceM: tsdDist ? Number(tsdDist) : remainingMeters,
                  speedKph: tsdSpeed ? Number(tsdSpeed) : undefined,
                  minutes: tsdMin ? Number(tsdMin) : undefined,
                });
                setOpsNote(tsd ? formatTsd(tsd) : "Enter any two of distance / speed / time.");
              }}
            >
              Solve TSD
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <select
                className="h-9 rounded-lg border bg-background px-2 text-sm"
                value={searchKind}
                onChange={(e) =>
                  setSearchKind(e.target.value as typeof searchKind)
                }
              >
                <option value="square">Expanding square</option>
                <option value="sector">Sector</option>
                <option value="creep">Creeping line</option>
                <option value="parallel">Parallel track</option>
              </select>
              <Input value={searchLeg} placeholder="Leg m" onChange={(e) => setSearchLeg(e.target.value)} />
            </div>
            <Button
              variant="outline"
              disabled={lat == null}
              onClick={() => {
                if (lat == null || lng == null) return;
                const L = Number(searchLeg) || 100;
                const hdg = heading ?? 0;
                const legs =
                  searchKind === "square"
                    ? expandingSquareLegs(L, 3)
                    : searchKind === "sector"
                      ? sectorSearchLegs(L, hdg, 3)
                      : searchKind === "creep"
                        ? creepingLineLegs(L * 3, L, 4, hdg)
                        : parallelTrackLegs(L * 3, L, 3, hdg);
                const line = searchLineFromLegs({ lat, lng }, legs);
                onSearchOverlay?.(line);
                setOpsNote(formatSearchPlan(searchKind, legs));
              }}
            >
              Plot search
            </Button>
            <Button variant="ghost" onClick={() => { onSearchOverlay?.(null); setOpsNote(null); }}>
              Clear search
            </Button>
            <Button
              variant="outline"
              disabled={!geometry}
              onClick={async () => {
                if (!geometry) return;
                const card = formatRouteCard(trailName, routeCardLegs(geometry));
                const ok = await copyEmergencyInfo(card);
                setOpsNote(ok ? card.split("\n").slice(0, 4).join("\n") + "\n… copied" : "Copy failed");
              }}
            >
              Copy route card
            </Button>
            <div className="grid grid-cols-3 gap-2">
              <Input value={tempC} placeholder="°C" onChange={(e) => setTempC(e.target.value)} />
              <Input value={windKph} placeholder="wind km/h" onChange={(e) => setWindKph(e.target.value)} />
              <Input value={rh} placeholder="RH %" onChange={(e) => setRh(e.target.value)} />
            </div>
            <p className="text-xs text-muted-foreground">
              {windChillWarning(Number(tempC), Number(windKph)) ??
                heatWarning(Number(tempC), Number(rh)) ??
                "Enter temp / wind / RH for wind-chill or heat index."}
            </p>
            <div className="flex gap-2">
              <Input value={flashSec} placeholder="flash-to-bang s" onChange={(e) => setFlashSec(e.target.value)} />
              <Button
                variant="outline"
                onClick={() => setOpsNote(lightningRule(Number(flashSec) || 0).warning)}
              >
                30–30
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input value={waterL} placeholder="Water L" onChange={(e) => setWaterL(e.target.value)} />
              <Input value={injured} placeholder="Injured" onChange={(e) => setInjured(e.target.value)} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={async () => {
                  const ok = await copyEmergencyInfo(
                    smeacBrief({ lat, lng, trailName, profile, returnAt: returnLocal || undefined }),
                  );
                  setOpsNote(ok ? "SMEAC copied" : "Copy failed");
                }}
              >
                Copy SMEAC
              </Button>
              <Button
                variant="outline"
                onClick={async () => {
                  const ok = await copyEmergencyInfo(
                    aceReport({
                      waterLiters: Number(waterL) || undefined,
                      injured: Number(injured) || 0,
                      partySize: profile.partySize,
                      lat,
                      lng,
                    }),
                  );
                  setOpsNote(ok ? "ACE copied" : "Copy failed");
                }}
              >
                Copy ACE
              </Button>
              <Button
                variant="outline"
                onClick={async () => {
                  const ok = await copyEmergencyInfo(saluteReport({ lat, lng, activity: trailName }));
                  setOpsNote(ok ? "SALUTE copied" : "Copy failed");
                }}
              >
                Copy SALUTE
              </Button>
              <Button
                variant="outline"
                onClick={async () => {
                  const ok = await copyEmergencyInfo(
                    fiveLineHeloBrief({
                      lat,
                      lng,
                      elevationFt: altitudeM != null ? altitudeM * 3.28084 : undefined,
                    }),
                  );
                  setOpsNote(ok ? "5-line LZ copied" : "Copy failed");
                }}
              >
                Copy 5-line LZ
              </Button>
              <Button
                variant="outline"
                onClick={async () => {
                  const ok = await copyEmergencyInfo(
                    fieldMetar({
                      sky: "SCT",
                      windKph: Number(windKph) || undefined,
                      lat,
                      lng,
                    }),
                  );
                  setOpsNote(ok ? "Field OBS copied" : "Copy failed");
                }}
              >
                Copy field OBS
              </Button>
            </div>
            {watchHint && <p className="text-xs text-muted-foreground">{watchHint}</p>}
            {lat != null && <p className="text-xs text-muted-foreground">{polarisHint(lat)}</p>}
            <p className="text-xs text-muted-foreground">
              CASEVAC: {evac.reason}
            </p>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={canWalk} onChange={(e) => setCanWalk(e.target.checked)} />
              Injured person can walk
            </label>
            {remainingMeters != null && remainingMeters > 0 && (
              <p className="text-xs text-muted-foreground">
                {litterEvacTime(remainingMeters, profile.partySize)}
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Input value={lpqSeen} placeholder="Last seen" onChange={(e) => setLpqSeen(e.target.value)} />
              <Input value={lpqClothes} placeholder="Clothing" onChange={(e) => setLpqClothes(e.target.value)} />
            </div>
            <Button
              variant="outline"
              onClick={async () => {
                const ok = await copyEmergencyInfo(
                  lostPersonQuery({
                    name: profile.name,
                    lastSeen: lpqSeen,
                    clothing: lpqClothes,
                    medical: profile.medical,
                    lat,
                    lng,
                  }),
                );
                setOpsNote(ok ? "Lost-person query copied" : "Copy failed");
              }}
            >
              Copy lost-person query
            </Button>
            {opsNote && (
              <p className="whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">{opsNote}</p>
            )}
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer font-medium text-foreground">Ford / night / LZ</summary>
              <p className="mt-2 font-medium text-foreground">Creek ford</p>
              <ul className="list-disc pl-4">
                {fordSop().map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
              <p className="mt-2 font-medium text-foreground">Night movement</p>
              <ul className="list-disc pl-4">
                {nightMovementSop().map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
              <p className="mt-2 font-medium text-foreground">LZ check</p>
              <ul className="list-disc pl-4">
                {lzAssessmentChecklist().map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </details>
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer font-medium text-foreground">Leapfrog / rally SOP</summary>
              <ul className="mt-2 list-disc pl-4">
                {leapfrogSop().map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
              <ul className="mt-2 list-disc pl-4">
                {rallySop().map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </details>
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
            <Label htmlFor="challenge">Night challenge</Label>
            <Input
              id="challenge"
              value={profile.challenge ?? ""}
              placeholder="Word you shout"
              onChange={(e) => void persistProfile({ ...profile, challenge: e.target.value })}
            />
            <Label htmlFor="password">Night password</Label>
            <Input
              id="password"
              value={profile.password ?? ""}
              placeholder="Expected reply"
              onChange={(e) => void persistProfile({ ...profile, password: e.target.value })}
            />
            <p className="text-xs font-medium text-foreground">Night regroup verify</p>
            <Input
              value={verifyChallengeIn}
              placeholder="Say the challenge word"
              onChange={(e) => setVerifyChallengeIn(e.target.value)}
            />
            <Input
              value={verifyPasswordIn}
              placeholder="Reply with password"
              onChange={(e) => setVerifyPasswordIn(e.target.value)}
            />
            <Button
              variant="outline"
              onClick={() => {
                const r = verifyRegroup({
                  challengeResponse: verifyChallengeIn,
                  passwordResponse: verifyPasswordIn,
                  expectedChallenge: profile.challenge,
                  expectedPassword: profile.password,
                });
                setVerifyMsg(r.message);
                window.setTimeout(() => setVerifyMsg(null), 3000);
              }}
            >
              Verify party
            </Button>
            {verifyMsg && <p className="text-xs text-muted-foreground">{verifyMsg}</p>}
            <Label htmlFor="medical">Medical notes</Label>
            <Input
              id="medical"
              value={profile.medical}
              placeholder="Allergies, meds, conditions"
              onChange={(e) => void persistProfile({ ...profile, medical: e.target.value })}
            />
          </div>

          <CapabilityTabs altitudeM={altitudeM} elevationProfile={elevationProfile} />

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
