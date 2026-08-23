"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  Droplets,
  LifeBuoy,
  Megaphone,
  MessageSquare,
  QrCode,
  Share2,
  Siren,
  Sun,
  Timer,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CapabilityTabs } from "@/components/safety/capability-tabs";
import { FieldCapture } from "@/components/offline/field-capture";
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
import { moonPhase, roundBearing } from "@/lib/safety/astro";
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
  type PositionSource,
} from "@/lib/safety/emergency";
import { breadcrumbGpx, isIceFilled, nearestWaypoint, safeFilename, safetySelfCheck } from "@/lib/safety/field";
import { saveTextFile } from "@/lib/platform/save-file";
import {
  lastOverdueNotificationSync,
  subscribeOverdueNotification,
} from "@/lib/platform/overdue-notification";
import { gainLastHourM } from "@/lib/safety/backtrack";
import { buildSafetyDossier } from "@/lib/safety/dossier";
import { formatFixAge } from "@/lib/safety/gps-quality";
import { useWakeLockHeld } from "@/hooks/use-wake-lock";
import {
  dropWaypoint,
  getIceProfile,
  getOverdueAlarm,
  overdueStatus,
  saveIceProfile,
  setOverdueAlarm,
  resolveLocalDateTime,
  type ResolvedLocalTime,
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
import { buildPaperBackup } from "@/lib/safety/paper-backup";
import { GuardianShare } from "@/components/safety/guardian-share";
import { estimateGuardianEta, guardianProgressPercent } from "@/lib/guardian/status";
import {
  decisionGradePackWeather,
  formatPackWeatherNote,
  type PackWeather,
} from "@/lib/offline/pack-weather";
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
  heatHazard,
  lightningRule,
  naismithMinutes,
  windChillHazard,
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
  litterEvacAdvice,
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
import { formatCompassCard } from "@/lib/safety/compass-display";
import { headingSourceLabel, type NavHeadingSource } from "@/lib/safety/device-heading";
import {
  adjacentGridSquares,
  formatMgrsGridCard,
  gridSquareBounds,
  mgrsGridTips,
} from "@/lib/safety/mgrs-grid";
import {
  formatHarvestCard,
  HARVEST_DISCLAIMER,
  survivalHarvestAssessment,
  survivalHarvestPriorities,
  huntingBasics,
  trappingBasics,
  gameFieldDressing,
  cookingWildGame,
} from "@/lib/safety/survival-harvest";
import {
  backstopChecklist,
  backstopDefinition,
  formatWayfindingCard,
  wayfindingAssessment,
  wayfindingTechniques,
} from "@/lib/safety/wayfinding";
import { verifyRegroup } from "@/lib/safety/verify";
import { medicalOverrideFromAltitude } from "@/lib/safety/triage-priority";
import { PositionQr } from "@/components/safety/position-qr";
import { PartyTriangulation } from "@/components/safety/party-triangulation";
import { buildSarHandoff } from "@/lib/qr/handoff";
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
  /** Real darkness from the solar calculation. Do not infer it from warning text. */
  isDark?: boolean;
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
  onDeniedPaceLen?: (paceLen: number) => void;
  onDeniedTerrain?: (terrain: PaceTerrain) => void;
  headingSource?: NavHeadingSource;
  positionSource?: PositionSource;
  geometry?: GeoJSON.LineString | GeoJSON.MultiLineString;
  remainingMeters?: number;
  remainingGainM?: number;
  traveledMeters?: number;
  elevationProfile?: Array<{ distanceMeters: number; elevation: number }>;
  onSearchOverlay?: (line: GeoJSON.LineString | null) => void;
  onCommsAttempt?: () => void;
  lastCommsAt?: number | null;
  onCheckinLogged?: () => void;
  packWeather?: PackWeather | null;
  batteryPct?: number | null;
}

/**
 * A plotted fix can land outside the UTM grid's 80S-84N validity band, where
 * formatUsng returns null. Interpolated raw that printed "Resection null".
 */
function gridOrUnavailable(lat: number, lng: number): string {
  return formatUsng(lat, lng) ?? "grid unavailable at this latitude — use lat/long";
}

/**
 * How far the party might really be from a bearing fix. The 3-pt readout used
 * to quote the spread of the three cuts instead, which is a cocked-hat
 * agreement check, not an accuracy: three cuts can close to half a metre on a
 * point 500 m from the party.
 */
function radiusPhrase(uncertaintyM: number | null): string {
  if (uncertaintyM == null) return "radius unquotable — cut too shallow";
  return `treat as ±${Math.round(uncertaintyM)} m`;
}

type WeatherFieldSource = "unknown" | "pack" | "manual";
type WeatherField = { value: string; source: WeatherFieldSource };
type WeatherFields = { tempC: WeatherField; windKph: WeatherField; rhPct: WeatherField };

const EMPTY_WEATHER_FIELDS: WeatherFields = {
  tempC: { value: "", source: "unknown" },
  windKph: { value: "", source: "unknown" },
  rhPct: { value: "", source: "unknown" },
};

function displayedWeatherField(field: WeatherField, packValue: number | undefined): WeatherField {
  if (field.source === "manual") return field;
  return packValue == null
    ? { value: "", source: "unknown" }
    : { value: String(packValue), source: "pack" };
}

function enteredWeatherNumber(field: WeatherField, packIsDecisionGrade: boolean): number | undefined {
  if (field.source === "pack" && !packIsDecisionGrade) return undefined;
  if (field.source === "unknown" || !field.value.trim()) return undefined;
  const value = Number(field.value);
  return Number.isFinite(value) ? value : undefined;
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
  isDark = false,
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
  onDeniedPaceLen,
  onDeniedTerrain,
  headingSource,
  positionSource,
  geometry,
  remainingMeters,
  remainingGainM,
  traveledMeters,
  elevationProfile = [],
  onSearchOverlay,
  onCommsAttempt,
  lastCommsAt = null,
  onCheckinLogged,
  packWeather,
  batteryPct,
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
  const [returnResolution, setReturnResolution] = useState<ResolvedLocalTime | null>(null);
  const [returnTimeMessage, setReturnTimeMessage] = useState<string | null>(null);
  const [profileSaveFailed, setProfileSaveFailed] = useState(false);
  const [returnTimeChoices, setReturnTimeChoices] = useState<[ResolvedLocalTime, ResolvedLocalTime] | null>(null);
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
  const [copiedCompass, setCopiedCompass] = useState(false);
  const [copiedGrid, setCopiedGrid] = useState(false);
  const [copiedWayfinding, setCopiedWayfinding] = useState(false);
  const [copiedHarvest, setCopiedHarvest] = useState(false);
  const [wayfindingOpen, setWayfindingOpen] = useState<string>("handrail");
  const [sereOpen, setSereOpen] = useState<SerePillar | "all">("survival");
  const [gridC, setGridC] = useState("");
  const [brgC, setBrgC] = useState("");
  const [tsdDist, setTsdDist] = useState("");
  const [tsdSpeed, setTsdSpeed] = useState("4");
  const [tsdMin, setTsdMin] = useState("");
  const [flashSec, setFlashSec] = useState("30");
  const [weatherFields, setWeatherFields] = useState<WeatherFields>(EMPTY_WEATHER_FIELDS);
  const [weatherNow, setWeatherNow] = useState<number | null>(null);
  const [waterL, setWaterL] = useState("2");
  const [injured, setInjured] = useState("0");
  const [searchKind, setSearchKind] = useState<"square" | "sector" | "creep" | "parallel">("square");
  const [searchLeg, setSearchLeg] = useState("100");
  const [opsNote, setOpsNote] = useState<string | null>(null);
  const [advancedWaypointStatus, setAdvancedWaypointStatus] = useState<string | null>(null);
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
  const [checkinOverdue, setCheckinOverdue] = useState(false);
  // Sticky: a storage-refused check-in or a failed arm must survive the 30-second
  // status tick, which recomputes the label from unchanged inputs and used to erase
  // the failure notice within one interval.
  const [checkinSaveError, setCheckinSaveError] = useState<string | null>(null);
  const [wildlifeAnimal, setWildlifeAnimal] = useState<WildlifeAnimal>("bear_grizzly");
  const [amsSymptoms, setAmsSymptoms] = useState<AmsSymptom[]>([]);
  const [verifyChallengeIn, setVerifyChallengeIn] = useState("");
  const [verifyPasswordIn, setVerifyPasswordIn] = useState("");
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);
  const [dossierStatus, setDossierStatus] = useState<string | null>(null);
  const [showHandoffQr, setShowHandoffQr] = useState(false);
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
      // A stored returnAt that no longer parses must not be reconstructed: the
      // Invalid Date's toISOString threw RangeError out of the render path and the
      // 30-second monitor effect, taking the whole navigate screen down. Skipping
      // reconstruction lets overdueStatus's fail-closed "not armed" label surface
      // instead of a crash.
      if (!Number.isFinite(new Date(alarm.returnAt).getTime())) return;
      if (alarm.resolvedLocal && alarm.timeZone && alarm.utcOffset) {
        setReturnResolution({
          instant: new Date(alarm.returnAt),
          resolvedLocal: alarm.resolvedLocal,
          timeZone: alarm.timeZone,
          utcOffset: alarm.utcOffset,
        });
      }
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
    const tick = () => setWeatherNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const packDecisionWeather = useMemo(
    () => (weatherNow == null ? null : decisionGradePackWeather(packWeather, weatherNow)),
    [packWeather, weatherNow],
  );

  useEffect(() => {
    const tick = () => {
      const last = checkins[0]?.recordedAt ?? null;
      const status = checkinStatus(last, checkinSettings);
      setCheckinLabel(status?.label ?? null);
      // Keep the lib's overdue boolean beside the label: the fail-closed states
      // (corrupt interval, unreadable timestamp, future-dated reference) are
      // overdue:true with labels that never contain the substring "OVERDUE", and
      // styling keyed on the text rendered them in the calm informational tier.
      setCheckinOverdue(status?.overdue === true);
    };
    tick();
    const id = window.setInterval(tick, 30000);
    return () => window.clearInterval(id);
  }, [checkins, checkinSettings]);

  useEffect(() => {
    const tick = () => {
      if (!returnResolution) {
        setOverdueLabel(null);
        setOverdue(false);
        return;
      }
      // overdueStatus always returns a shaped result; an invalid deadline comes
      // back with valid: false and a label that says the alarm is not armed.
      // The label is rendered unconditionally, so that state stays visible.
      const status = overdueStatus(returnResolution.instant.toISOString());
      setOverdueLabel(status.label);
      setOverdue(status.overdue);
    };
    tick();
    const id = window.setInterval(tick, 30000);
    return () => window.clearInterval(id);
  }, [returnResolution]);

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
        positionSource,
      }),
    [lat, lng, accuracyM, trailName, offTrailM, stale, recordedAt, profile, positionSource],
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
      void saveIceProfile(next).then((stored) => setProfileSaveFailed(!stored));
    }, 400);
  }

  const nearest = useMemo(
    () => (lat != null && lng != null ? nearestWaypoint({ lat, lng }, waypoints) : null),
    [lat, lng, waypoints],
  );

  const wakeLockHeld = useWakeLockHeld();

  const checks = useMemo(
    () =>
      safetySelfCheck({
        packReady: true,
        gpsTrusted,
        iceFilled: isIceFilled(profile),
        returnSet: Boolean(returnLocal),
        wakeLock: wakeLockHeld,
        crumbs: trackPoints.length,
        gpsDenied,
      }),
    [gpsTrusted, profile, returnLocal, trackPoints.length, gpsDenied, wakeLockHeld],
  );

  const moon = useMemo(() => moonPhase(), []);
  const gm = lat != null && lng != null ? gmAngleCard(lat, lng) : null;
  const declination = lat != null && lng != null ? magneticDeclination(lat, lng) : null;
  const imsafeNote = imsafeWarning(imsafe);
  // Previously sniffed with /dark|sunset|headlamp|polar night/ over whichever warning
  // happened to rank first — so "finish with a headlamp" read as darkness at midday,
  // and a GPS-denied or overdue warning read as daylight at midnight. It feeds
  const sereNote = sereAssessment({
    isDark,
    altitudeM,
    partySize: profile.partySize,
    hasSignal: gpsTrusted,
  });
  const wayfindingNote = wayfindingAssessment({
    offTrail: offTrailM != null && offTrailM > 25,
    visibilityPoor: isDark,
    hasBackstop: backtrackEnabled,
  });
  const displayedWeatherFields: WeatherFields = {
    tempC: displayedWeatherField(weatherFields.tempC, packDecisionWeather?.tempC),
    windKph: displayedWeatherField(weatherFields.windKph, packDecisionWeather?.windKph),
    rhPct: displayedWeatherField(weatherFields.rhPct, packDecisionWeather?.rhPct),
  };
  const observedTempC = enteredWeatherNumber(displayedWeatherFields.tempC, packDecisionWeather != null);
  const observedWindKph = enteredWeatherNumber(displayedWeatherFields.windKph, packDecisionWeather != null);
  const observedRhPct = enteredWeatherNumber(displayedWeatherFields.rhPct, packDecisionWeather != null);
  const guardianProgress = guardianProgressPercent(traveledMeters, remainingMeters);
  const guardianEta = estimateGuardianEta({
    nowMs: recordedAt ?? Number.NaN,
    startedAtMs: trackPoints[0] ? Date.parse(trackPoints[0].recordedAt) : null,
    traveledMeters,
    remainingMeters,
  });
  const coldHazardNote =
    observedTempC != null && observedWindKph != null
      ? windChillHazard(observedTempC, observedWindKph)
      : null;
  const heatHazardNote =
    observedTempC != null && observedRhPct != null
      ? heatHazard(observedTempC, observedRhPct)
      : null;
  // The two are mutually exclusive by temperature band (wind chill needs ≤10 °C,
  // heat index needs ≥27 °C), so first-non-null is a selection, not a suppression.
  const weatherHazard = coldHazardNote ?? heatHazardNote;
  const harvestNote = survivalHarvestAssessment({
    daysLost: 1,
    tempC: observedTempC,
    hasFire: false,
  });
  const sereSectionsList = useMemo(() => sereSections(), []);
  const mgrsCell = lat != null && lng != null ? gridSquareBounds(lat, lng, 1000) : null;
  const mgrsNeighbors = lat != null && lng != null ? adjacentGridSquares(lat, lng, 1000) : [];
  const wayfindingTips = useMemo(() => wayfindingTechniques(), []);
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
      ? sunVsWatchCheck(new Date(), lat, lng)
      : null;
  const amsResult = amsAssessment({
    altitudeM,
    gainLastHourM: gainLastHourM(trackPoints),
    symptoms: amsSymptoms,
  });
  // Severe AMS and the CASEVAC card used to render contradictory orders side by
  // side — "descend immediately. This is an emergency." beside "Non-walker — stay
  // put". The medical override makes one instruction govern.
  const evac = casevacDecision({
    injured: (Number(injured) || 0) > 0,
    canWalk,
    isDark,
    remainingM: remainingMeters,
    partySize: profile.partySize,
    medicalOverride: medicalOverrideFromAltitude({ mustDescend: amsResult.level === "severe" }),
  });
  const beadsInfo = paceBeads(beads);
  // No aspect: heading is the direction of travel, not the direction the slope faces.
  const avyNote = slopePct != null ? avalancheTerrainWarning({ slopePct }) : null;

  async function persistCheckinSettings(next: CheckinSettings) {
    // The optimistic state must carry an arm time: without one the 30-second monitor
    // tick judged the schedule against a stale check-in and flashed a false
    // "OVERDUE — send SOS" until the store round-trip landed (up to 5 s on a blocked
    // open). Mirror the store's own rule: enabling stamps a fresh armedAt.
    setCheckinSettings(
      next.enabled && !checkinSettings.enabled
        ? { ...next, armedAt: new Date().toISOString() }
        : next,
    );
    const stored = await saveCheckinSettings(next);
    // The store is the authority on armedAt (a re-enable stamps it fresh) and on
    // interval normalization — re-read so the in-memory monitor matches what will be
    // true after a reload. On a refused write this also snaps the checkbox back to
    // the stored truth — which is why the failure line below must say so.
    setCheckinSettings(await getCheckinSettings());
    setCheckinSaveError(
      stored
        ? null
        : next.enabled
          ? "Monitor NOT armed — this phone refused to store the setting. Nothing will watch your check-ins: keep your own clock or tell your contact."
          : "Change NOT saved — this phone refused to store it. The monitor may still be in its previous state.",
    );
  }

  /**
   * A refused notification permission is invisible otherwise. `setOverdueAlarm`
   * fires the sync and forgets it — correctly, since the write path must not
   * wait on the native bridge — so the outcome is read from the seam instead.
   * Only an outright refusal is worth surfacing: "unsupported" is the honest
   * steady state on the web, where the in-app banner has always been the whole
   * mechanism.
   */
  const [alarmRefused, setAlarmRefused] = useState(
    () => lastOverdueNotificationSync().status === "failed",
  );
  useEffect(
    () => subscribeOverdueNotification((sync) => setAlarmRefused(sync.status === "failed")),
    [],
  );

  // The deadline message used to be written before the store was awaited, so a phone
  // that refused the write left an alarm that read as armed and did nothing.
  function deadlineMessage(time: ResolvedLocalTime, stored: boolean) {
    const when = `${time.resolvedLocal} (${time.utcOffset}, ${time.timeZone})`;
    return stored
      ? `Deadline: ${when}.`
      : `NOT SAVED — this phone refused to store ${when}. Nothing here will warn you when it passes: write it down and tell your contact.`;
  }

  async function persistReturn(value: string) {
    setReturnLocal(value);
    setReturnTimeMessage(null);
    setReturnTimeChoices(null);
    if (!value) {
      setReturnResolution(null);
      if (!(await setOverdueAlarm(null))) {
        setReturnTimeMessage("Could not clear the stored deadline — the old one may still be armed.");
      }
      return;
    }
    const resolved = resolveLocalDateTime(value);
    if (resolved.kind === "resolved") {
      setReturnResolution(resolved.value);
      setReturnTimeMessage(deadlineMessage(resolved.value, await setOverdueAlarm(resolved.value)));
      return;
    }
    setReturnResolution(null);
    setReturnTimeMessage(resolved.message);
    if (resolved.kind === "ambiguous") setReturnTimeChoices(resolved.choices);
    await setOverdueAlarm(null);
  }

  async function chooseReturnOccurrence(choice: ResolvedLocalTime) {
    setReturnResolution(choice);
    setReturnTimeChoices(null);
    setReturnTimeMessage(deadlineMessage(choice, await setOverdueAlarm(choice)));
  }

  async function markWaypoint(kind: SafetyWaypoint["kind"], note?: string) {
    if (lat == null || lng == null) return;
    setAdvancedWaypointStatus("Saving waypoint on this phone…");
    try {
      const point = await dropWaypoint(packId, kind, lat, lng, note, {
        accuracyM,
        source: positionSource ?? (stale ? "lastKnown" : "gps"),
        recordedAt,
      });
      onWaypointsChange([point, ...waypoints.filter((item) => item.id !== point.id)]);
      setAdvancedWaypointStatus(`${kind.toUpperCase()} waypoint saved and checked on this phone.`);
    } catch (error) {
      setAdvancedWaypointStatus(error instanceof Error ? error.message : "The waypoint was not saved.");
    }
  }

  async function handleCheckin() {
    const { entry, saved } = await logCheckin(packId, {
      lat,
      lng,
      note: checkinSettings.enabled ? "I'm OK" : undefined,
    });
    if (!saved) {
      // A check-in that never landed must not be shown as logged: after a reload no
      // one — including the SAR dossier — would ever see it. This goes in the sticky
      // error state, not the status label: the 30-second tick recomputes the label
      // from unchanged inputs and used to erase the warning within one interval.
      setCheckinSaveError("Check-in NOT SAVED — storage unavailable. Try again or note the time on paper.");
      return;
    }
    setCheckinSaveError(null);
    setCheckins((prev) => [entry, ...prev].slice(0, 20));
    const status = checkinStatus(entry.recordedAt, checkinSettings);
    setCheckinLabel(status?.label ?? null);
    setCheckinOverdue(status?.overdue === true);
    onCheckinLogged?.();
  }

  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button
            variant="secondary"
            size="icon-sm"
            className="navigate-emergency-trigger"
            aria-label="Safety and SOS"
          />
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
            Save a place, backtrack, check in, or get emergency information.
          </SheetDescription>
        </SheetHeader>

        <section className="grid grid-cols-2 gap-2 px-4" aria-label="Emergency actions">
          <Button className="min-h-11" onClick={() => void handleCopy()} variant="outline">
            <Copy className="mr-2 size-4" />
            {copied === "ok" ? "Grid copied" : copied === "fail" ? "Copy failed" : "Copy emergency grid"}
          </Button>
          <Button className="min-h-11" onClick={() => void handleShare()} variant="outline">
            <Share2 className="mr-2 size-4" />
            Share emergency grid
          </Button>
          <Button
            className="min-h-11"
            variant="outline"
            onClick={() => {
              window.location.href = smsHref(profile.icePhone, message);
            }}
          >
            <MessageSquare className="mr-2 size-4" />
            SMS ICE
          </Button>
          <Button
            className="min-h-11"
            variant="destructive"
            onClick={onBeacon}
            aria-describedby="sound-flash-locator-warning"
          >
            <Siren className="mr-2 size-4" />
            Sound &amp; flash locator
          </Button>
          <p
            id="sound-flash-locator-warning"
            className="col-span-2 rounded-md border border-destructive/50 bg-destructive/10 p-2 text-center text-xs font-bold text-destructive"
          >
            Does not contact 911, SAR, or transmit your location.
          </p>
        </section>

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
            <>
              <p className="text-xs text-muted-foreground">
                {gm.gridToMagnetic}. {gm.magneticToGrid}. {moon.nightNav}
              </p>
              {gm.staleness && (
                <p className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-2 text-xs">
                  {gm.staleness}
                </p>
              )}
            </>
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
                checkinOverdue
                  ? "border-destructive bg-destructive/10 text-destructive"
                  : "border-amber-500/50 bg-amber-500/10"
              }`}
            >
              <Timer className="mt-0.5 size-4 shrink-0" />
              <p>{checkinLabel}</p>
            </div>
          )}

          {checkinSaveError && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <p>{checkinSaveError}</p>
            </div>
          )}

          {offTrailM != null && offTrailM > 35 && !stale && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
              <div>
                <p className="font-medium text-safety-critical">
                  {Math.round(offTrailM)} m off route
                </p>
                {bearingToTrail != null && Number.isFinite(bearingToTrail) && (
                  <p className="mt-1 text-safety-critical">
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
                {formatUsng(lat, lng) ? (
                  <>
                    <p className="mt-1 font-mono text-xs">USNG {formatUsng(lat, lng)}</p>
                    <p className="font-mono text-xs">MGRS10 {formatMgrs10(lat, lng)}</p>
                  </>
                ) : (
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                    UTM/USNG unavailable at this latitude — use latitude/longitude or a polar grid.
                  </p>
                )}
                <p className="font-mono text-xs text-muted-foreground">{formatDdm(lat, lng)}</p>
                <p className="font-mono text-xs text-muted-foreground">{formatDms(lat, lng)}</p>
                {formatUtm(lat, lng) && <p className="font-mono text-xs text-muted-foreground">{formatUtm(lat, lng)}</p>}
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
                {bearingToStart != null && Number.isFinite(bearingToStart) && !stale && (
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

          <FieldCapture
            packId={packId}
            trailName={trailName}
            lat={lat}
            lng={lng}
            accuracyM={accuracyM}
            stale={stale}
            recordedAt={recordedAt}
            positionSource={positionSource}
            waypoints={waypoints}
            onWaypointsChange={onWaypointsChange}
          />

          <div className="grid grid-cols-2 gap-2">
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
              disabled={trackPoints.length < 2}
              onClick={async () => {
                const gpx = breadcrumbGpx(`${trailName} breadcrumbs`, trackPoints);
                // saveTextFile reports whether a save actually ran. It used to be
                // a synchronous throw, which never happened inside WKWebView — so
                // this clipboard fallback was dead on iOS and the button claimed
                // a download that had failed.
                if (await saveTextFile(`${safeFilename(trailName)}-track.gpx`, gpx, "application/gpx+xml")) {
                  setGpxStatus("GPX downloaded");
                } else {
                  const copied = await copyEmergencyInfo(gpx);
                  setGpxStatus(copied ? "GPX copied" : "GPX export failed");
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
            {/* Never gated on a GPS fix: a check-in is proof of life, not a position
                report (logCheckin's lat/lng are optional by design), and the overdue
                banner tells the user to tap this exact button. */}
            <Button variant="outline" onClick={() => void handleCheckin()}>
              <CheckCircle2 className="mr-2 size-4" />
              I&apos;m OK
            </Button>
          </div>

          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer text-sm font-medium">
              Advanced navigation and SAR tools
            </summary>
            <p className="mt-2 text-xs text-muted-foreground">
              These coded markers and dead-reckoning tools are for people trained to use them.
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Button variant="outline" disabled={lat == null} onClick={() => void markWaypoint("lkp")}>
                Last known point
              </Button>
              <Button variant="outline" disabled={lat == null} onClick={() => void markWaypoint("rp")}>
                Rally point
              </Button>
              <Button variant="outline" disabled={lat == null} onClick={() => void markWaypoint("ap")}>
                Approach point
              </Button>
              <Button variant="outline" disabled={lat == null} onClick={() => void markWaypoint("cf")}>
                Catch feature
              </Button>
              <Button variant="outline" disabled={lat == null} onClick={() => void markWaypoint("hr")}>
                Handrail
              </Button>
              <Button
                variant={gpsDenied ? "default" : "outline"}
                disabled={!gpsDenied && !gpsTrusted}
                onClick={() => onToggleGpsDenied?.()}
              >
                {gpsDenied ? "Exit GPS-denied mode" : "GPS-denied mode"}
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
                  positionSource,
                  offTrailM,
                  returnAt: returnResolution?.instant.toISOString() ?? null,
                  checkins,
                  navLegs: legs,
                  waypoints,
                });
                const ok = await copyEmergencyInfo(text);
                if (!ok) {
                  // Last resort for the dossier: if this fails too, it exists
                  // nowhere, and saying otherwise is the worst possible lie here.
                  const saved = await saveTextFile(
                    `${safeFilename(trailName)}-dossier.txt`,
                    text,
                    "text/plain",
                  );
                  setDossierStatus(saved ? "Dossier downloaded" : "Dossier NOT saved");
                } else {
                  setDossierStatus("Dossier copied");
                }
                window.setTimeout(() => setDossierStatus(null), 2500);
              }}
            >
              <Download className="mr-2 size-4" />
              {dossierStatus ?? "Safety dossier"}
            </Button>
            <Button
              variant="outline"
              disabled={!geometry}
              onClick={async () => {
                if (!geometry) return;
                const text = buildPaperBackup({
                  trailName,
                  geometry,
                  profile,
                  returnAt: (() => {
                    if (returnResolution?.instant) return returnResolution.instant.toISOString();
                    if (!returnLocal) return null;
                    const parsed = Date.parse(returnLocal);
                    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
                  })(),
                  checkins,
                  packAge: packWeather?.cachedAt,
                  // The first breadcrumb is where this party actually set off, which the
                  // stored line direction cannot tell us.
                  startedFrom: trackPoints[0]
                    ? { lat: trackPoints[0].lat, lng: trackPoints[0].lng }
                    : null,
                });
                const ok = await copyEmergencyInfo(text);
                if (ok) {
                  setDossierStatus("Paper backup copied");
                } else {
                  const saved = await saveTextFile(
                    `${safeFilename(trailName)}-paper.txt`,
                    text,
                    "text/plain",
                  );
                  setDossierStatus(saved ? "Paper backup downloaded" : "Paper backup NOT saved");
                }
                window.setTimeout(() => setDossierStatus(null), 2500);
              }}
            >
              Paper backup
            </Button>
            <Button variant="outline" onClick={() => setShowHandoffQr((open) => !open)}>
              <QrCode className="mr-2 size-4" />
              {showHandoffQr ? "Hide handoff QR" : "Handoff QR"}
            </Button>
            </div>
            {showHandoffQr && (
              <div className="mt-3 rounded-lg border p-3">
                <PositionQr
                  payload={buildSarHandoff({
                    trailName,
                    lat,
                    lng,
                    recordedAt,
                    positionSource,
                    stale,
                    returnAtIso: returnResolution?.instant.toISOString() ?? null,
                    profile,
                  })}
                  label="SAR handoff"
                />
              </div>
            )}
            {/* The receiving half of the same loop: read a position off another
                phone's screen, then work the party picture and cross-bearings
                from it. */}
            <div className="mt-3">
              <PartyTriangulation lat={lat} lng={lng} headingTrue={heading} />
            </div>
            {advancedWaypointStatus && (
              <p className="mt-2 text-xs text-muted-foreground" aria-live="polite">
                {advancedWaypointStatus}
              </p>
            )}
          </details>
          <GuardianShare
            trailName={trailName}
            profile={profile}
            shareKey={packId}
            returnAt={
              returnResolution?.instant
                ? returnResolution.instant.toISOString()
                : returnLocal && Number.isFinite(Date.parse(returnLocal))
                  ? new Date(returnLocal).toISOString()
                  : null
            }
            geometry={geometry}
            lat={lat}
            lng={lng}
            accuracyM={accuracyM}
            offTrailM={offTrailM}
            positionSource={positionSource}
            lastUpdateAt={recordedAt}
            batteryPct={batteryPct}
            progressPct={guardianProgress}
            etaAt={guardianEta}
            canPublishStatus={gpsTrusted && positionSource === "gps" && guardianProgress != null}
          />
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
            <Button variant="outline" onClick={() => void handleCheckin()}>
              Log I&apos;m OK now
            </Button>
            {checkins.length > 0 && (
              <p className="whitespace-pre-wrap font-mono text-[10px] text-muted-foreground">
                {formatCheckinLog(checkins.slice(0, 5))}
              </p>
            )}
          </div>

          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer text-sm font-medium">Advanced tools and field guides</summary>
            <p className="mt-2 text-xs text-muted-foreground">
              Specialist land navigation, SAR reports, medical references, and survival calculations.
            </p>
            <div className="mt-3 space-y-4">

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
              // The lib grades four levels; flattening them all into small amber text
              // typeset "This is an emergency" identically to "slow down".
              <p
                className={
                  amsResult.level === "severe"
                    ? "rounded-lg border border-destructive bg-destructive/10 p-2 text-xs font-medium text-destructive"
                    : "text-xs text-amber-700 dark:text-amber-400"
                }
              >
                {amsResult.warning}
              </p>
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
                {bearSafetyCard().map((line) => (
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
                {wildernessFirstAidCard().map((line) => (
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
                  const parsed = parseUsng(gotoGrid);
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
                Current heading {roundBearing(heading)}° true. Dead-reckon{" "}
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
                <Input
                  id="pace-len"
                  value={paceLen}
                  onChange={(e) => {
                    setPaceLen(e.target.value);
                    const n = Number(e.target.value);
                    if (Number.isFinite(n) && n > 0) onDeniedPaceLen?.(n);
                  }}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="terrain">Terrain factor</Label>
              <select
                id="terrain"
                className="h-9 w-full rounded-lg border bg-background px-2 text-sm"
                value={terrain}
                onChange={(e) => {
                  const next = e.target.value as PaceTerrain;
                  setTerrain(next);
                  // The parent's DR fix applies the same factor — without this the
                  // panel narrated 800 m while the SOS position advanced 1000 m.
                  onDeniedTerrain?.(next);
                }}
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
                if (!dest) {
                  setGotoInfo("Dead reckon unavailable — check GPS position, heading, and distance.");
                  return;
                }
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
              Compass readout
            </p>
            {heading != null && lat != null && lng != null ? (
              <p className="text-sm font-medium tabular-nums">
                {formatWalkBearing(heading, lat, lng)}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Heading unavailable — enable GPS or enter true degrees for dead reckoning.
              </p>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await navigator.clipboard.writeText(
                  formatCompassCard({
                    headingTrue: heading,
                    lat,
                    lng,
                    // The fused source from the page, never re-derived from gpsDenied:
                    // a magnetometer heading labeled "GPS" told stationary readers to
                    // distrust a live compass.
                    source: headingSource
                      ? headingSourceLabel(headingSource)
                      : gpsDenied
                        ? "Dead reckon"
                        : "GPS",
                    sourceKind: headingSource,
                  }),
                );
                setCopiedCompass(true);
                window.setTimeout(() => setCopiedCompass(false), 2000);
              }}
            >
              {copiedCompass ? "Compass card copied" : "Copy compass card"}
            </Button>
          </div>

          <div className="rounded-lg border p-3 space-y-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              MGRS grid squares
            </p>
            {mgrsCell ? (
              <>
                <p className="text-sm font-medium">{mgrsCell.grid}</p>
                <p className="text-xs text-muted-foreground">
                  100 km square: {mgrsCell.hundredKmId} · 1 km cell for land nav
                </p>
                {mgrsNeighbors.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Adjacent:{" "}
                    {mgrsNeighbors.map((n) => `${n.direction} ${n.grid}`).join(" · ")}
                  </p>
                )}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Waiting for GPS grid…</p>
            )}
            <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
              {mgrsGridTips().map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
            <Button
              variant="outline"
              size="sm"
              disabled={lat == null || lng == null}
              onClick={async () => {
                if (lat == null || lng == null) return;
                await navigator.clipboard.writeText(formatMgrsGridCard(lat, lng));
                setCopiedGrid(true);
                window.setTimeout(() => setCopiedGrid(false), 2000);
              }}
            >
              {copiedGrid ? "Grid card copied" : "Copy MGRS grid card"}
            </Button>
          </div>

          <div className="rounded-lg border p-3 space-y-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Wayfinding — backstops &amp; techniques
            </p>
            <p className="text-xs text-muted-foreground">{backstopDefinition()}</p>
            <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
              {backstopChecklist().map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-1">
              {wayfindingTips.map((t) => (
                <Button
                  key={t.id}
                  size="sm"
                  variant={wayfindingOpen === t.id ? "default" : "outline"}
                  onClick={() => setWayfindingOpen(t.id)}
                >
                  {t.title}
                </Button>
              ))}
            </div>
            {wayfindingTips
              .filter((t) => t.id === wayfindingOpen)
              .map((t) => (
                <div key={t.id}>
                  <p className="text-xs font-medium text-foreground">{t.summary}</p>
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                    {t.steps.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                </div>
              ))}
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await navigator.clipboard.writeText(formatWayfindingCard(trailName));
                setCopiedWayfinding(true);
                window.setTimeout(() => setCopiedWayfinding(false), 2000);
              }}
            >
              {copiedWayfinding ? "Wayfinding card copied" : "Copy wayfinding card"}
            </Button>
          </div>

          <div className="rounded-lg border p-3 space-y-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Resection / offset / box / mils
            </p>
            <p className="text-xs text-muted-foreground">
              Resection: bearing FROM you TO each known point. Intersection: bearing FROM each
              observer TO the unknown.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Input value={gridA} placeholder="Known A grid" onChange={(e) => setGridA(e.target.value)} />
              <Input value={brgA} placeholder="Bearing FROM observer A" onChange={(e) => setBrgA(e.target.value)} />
              <Input value={gridB} placeholder="Known B grid" onChange={(e) => setGridB(e.target.value)} />
              <Input value={brgB} placeholder="Bearing FROM observer B" onChange={(e) => setBrgB(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={bearingsMag}
                onChange={(e) => setBearingsMag(e.target.checked)}
              />
              Bearings are magnetic
            </label>
            {bearingsMag && declination == null && (
              <p className="text-xs text-destructive">
                Magnetic unavailable here — enter true bearings. Do not treat compass as already converted.
              </p>
            )}
            <Button
              variant="outline"
              onClick={() => {
                const a = parseUsng(gridA);
                const b = parseUsng(gridB);
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
                if (bearingsMag) {
                  if (declination == null) {
                    setResectInfo("Magnetic unavailable here — enter true bearings or uncheck magnetic.");
                    return;
                  }
                  azA = toTrueBearing(azA, declination);
                  azB = toTrueBearing(azB, declination);
                }
                const fix = resection(a, azA, b, azB);
                if (!fix) {
                  setResectInfo("No cut — check bearings and that the rays cross.");
                  return;
                }
                onGoto(fix.point);
                setResectInfo(
                  `Resection ${gridOrUnavailable(fix.point.lat, fix.point.lng)} · cut ${Math.round(fix.cutDeg)}° · ${radiusPhrase(fix.uncertaintyM)}${fix.warning ? ` — ${fix.warning}` : ""}`,
                );
              }}
            >
              Plot resection
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Input value={gridC} placeholder="Known C (3-pt)" onChange={(e) => setGridC(e.target.value)} />
              <Input value={brgC} placeholder="Bearing FROM observer C" onChange={(e) => setBrgC(e.target.value)} />
            </div>
            <Button
              variant="outline"
              onClick={() => {
                const a = parseUsng(gridA);
                const b = parseUsng(gridB);
                const c = parseUsng(gridC);
                if (!a || !b || !c) {
                  setResectInfo("Need three valid USNG/MGRS points for 3-pt.");
                  return;
                }
                const toTrue = (raw: string) => {
                  const az = Number(raw);
                  if (!Number.isFinite(az)) return null;
                  if (bearingsMag) {
                    if (declination == null) return null;
                    return toTrueBearing(az, declination);
                  }
                  return az;
                };
                const azA = toTrue(brgA);
                const azB = toTrue(brgB);
                const azC = toTrue(brgC);
                if (azA == null || azB == null || azC == null) {
                  setResectInfo(
                    bearingsMag && declination == null
                      ? "Magnetic unavailable here — enter true bearings or uncheck magnetic."
                      : "All three bearings must be numbers.",
                  );
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
                  `3-pt ${gridOrUnavailable(fix.point.lat, fix.point.lng)} · ${radiusPhrase(fix.uncertaintyM)} · cuts agree to ${Math.round(fix.spreadM)} m (agreement is not accuracy)${fix.warning ? ` — ${fix.warning}` : ""}`,
                );
              }}
            >
              3-pt resection
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const a = parseUsng(gridA);
                const b = parseUsng(gridB);
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
                if (bearingsMag) {
                  if (declination == null) {
                    setResectInfo("Magnetic unavailable here — enter true bearings or uncheck magnetic.");
                    return;
                  }
                  azA = toTrueBearing(azA, declination);
                  azB = toTrueBearing(azB, declination);
                }
                const hit = intersection(a, azA, b, azB);
                if (!hit) {
                  setResectInfo("No intersection — rays do not cross.");
                  return;
                }
                onGoto(hit.point);
                setResectInfo(
                  `Intersection ${gridOrUnavailable(hit.point.lat, hit.point.lng)} · cut ${Math.round(hit.cutDeg)}° · ${radiusPhrase(hit.uncertaintyM)}${hit.warning ? ` — ${hit.warning}` : ""}`,
                );
              }}
            >
              Intersection (unknown)
            </Button>
            {resectInfo && <p className="text-xs text-muted-foreground">{resectInfo}</p>}
            <div className="grid grid-cols-2 gap-2">
              <Input value={offsetM} onChange={(e) => setOffsetM(e.target.value)} placeholder="Offset m" />
              <div>
                <Label htmlFor="aim-off-side">Aim-off side</Label>
                <select
                  id="aim-off-side"
                  className="h-9 w-full rounded-lg border bg-background px-2 text-sm"
                  value={offsetSide}
                  onChange={(e) => setOffsetSide(e.target.value as "left" | "right")}
                >
                  <option value="right">Offset right</option>
                  <option value="left">Offset left</option>
                </select>
              </div>
            </div>
            <Button
              variant="outline"
              disabled={lat == null || !gotoGrid}
              onClick={() => {
                if (lat == null || lng == null) return;
                const dest = parseUsng(gotoGrid);
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
                if (!off) {
                  setGotoInfo("Aim-off unavailable — check both positions and offset.");
                  return;
                }
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
                if (!box) {
                  setGotoInfo("Obstacle box unavailable — check GPS position, heading, and distances.");
                  return;
                }
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
              <div>
                <Label htmlFor="search-pattern">Search pattern</Label>
                <select
                  id="search-pattern"
                  className="h-9 w-full rounded-lg border bg-background px-2 text-sm"
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
              </div>
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
            {packWeather && weatherNow != null && (
              <p className="text-xs text-muted-foreground col-span-full">
                {formatPackWeatherNote(packWeather, weatherNow)}
              </p>
            )}
            <div className="grid grid-cols-3 gap-2">
              {([
                ["tempC", "Temperature °C", "°C"],
                ["windKph", "Wind km/h", "wind km/h"],
                ["rhPct", "Relative humidity %", "RH %"],
              ] as const).map(([key, label, placeholder]) => (
                <div key={key} className="space-y-1">
                  <Label htmlFor={`field-weather-${key}`} className="sr-only">{label}</Label>
                  <Input
                    id={`field-weather-${key}`}
                    inputMode="decimal"
                    value={displayedWeatherFields[key].value}
                    placeholder={placeholder}
                    onChange={(event) => {
                      const value = event.target.value;
                      setWeatherFields((current) => ({
                        ...current,
                        [key]: {
                          value,
                          // Clearing a pack value is an explicit choice too. Keep
                          // it blank instead of silently restoring the snapshot
                          // on the next one-minute freshness tick.
                          source: "manual",
                        },
                      }));
                    }}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    {displayedWeatherFields[key].source === "manual"
                      ? displayedWeatherFields[key].value.trim() ? "your observation" : "left blank by you"
                      : displayedWeatherFields[key].source === "pack" && packDecisionWeather
                        ? "fresh pack snapshot"
                        : "unknown"}
                  </p>
                </div>
              ))}
            </div>
            {weatherHazard ? (
              // Styled by the lib's severity, never by the text: the frostbite and
              // heat-stroke bands used to render byte-identical to the muted
              // "weather unknown" placeholder they replace.
              <p
                className={
                  weatherHazard.severity === "danger"
                    ? "rounded-lg border border-destructive bg-destructive/10 p-2 text-xs font-medium text-destructive"
                    : weatherHazard.severity === "advisory"
                      ? "rounded-lg border border-amber-500/50 bg-amber-500/10 p-2 text-xs"
                      : "text-xs text-muted-foreground"
                }
              >
                {weatherHazard.text}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Weather unknown or outside calculator ranges. Enter observations you personally confirm; blank fields never become zero.
              </p>
            )}
            <div className="flex gap-2">
              <Input value={flashSec} placeholder="flash-to-bang s" onChange={(e) => setFlashSec(e.target.value)} />
              <Button
                variant="outline"
                onClick={() => setOpsNote(lightningRule(Number(flashSec) || 0)?.warning ?? "Enter a valid flash-to-bang time.")}
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
                      windKph: observedWindKph,
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
            {remainingMeters != null && remainingMeters > 0 && (() => {
              const litter = litterEvacAdvice(remainingMeters, profile.partySize);
              if (!litter) return null;
              return (
                <p
                  className={
                    litter.feasible
                      ? "text-xs text-muted-foreground"
                      : "rounded border border-destructive/50 bg-destructive/10 p-2 text-xs font-medium text-destructive"
                  }
                >
                  {litter.message}
                </p>
              );
            })()}
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
                    positionSource,
                    stale,
                    // Casualty counts from the CASEVAC inputs above, not the party size.
                    litter: canWalk ? 0 : Math.max(1, Number(injured) || 1),
                    ambulatory: canWalk ? Math.max(1, Number(injured) || 1) : 0,
                    precedence: Number(injured) > 0 && !canWalk ? "A" : "B",
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

          {wayfindingNote && (
            <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
              {wayfindingNote}
            </div>
          )}

          <div className="rounded-lg border p-3 space-y-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Survival harvest — hunting · trapping · cook
            </p>
            <p className="text-xs text-muted-foreground">{HARVEST_DISCLAIMER}</p>
            {harvestNote && (
              <p className="text-xs font-medium text-amber-800 dark:text-amber-200">{harvestNote}</p>
            )}
            <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
              {survivalHarvestPriorities().map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer font-medium text-foreground">Hunting &amp; trapping</summary>
              <p className="mt-2 font-medium text-foreground">Hunting</p>
              <ul className="list-disc pl-4">
                {huntingBasics().map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
              <p className="mt-2 font-medium text-foreground">Trapping</p>
              <ul className="list-disc pl-4">
                {trappingBasics().map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </details>
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer font-medium text-foreground">Field dress &amp; cook</summary>
              <ul className="mt-2 list-disc pl-4">
                {gameFieldDressing().map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
              <ul className="mt-2 list-disc pl-4">
                {cookingWildGame().map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </details>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await navigator.clipboard.writeText(formatHarvestCard());
                setCopiedHarvest(true);
                window.setTimeout(() => setCopiedHarvest(false), 2000);
              }}
            >
              {copiedHarvest ? "Harvest card copied" : "Copy harvest card"}
            </Button>
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

          <CapabilityTabs altitudeM={altitudeM} elevationProfile={elevationProfile} />
            </div>
          </details>

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
            {returnTimeChoices && (
              <div className="flex gap-2">
                {returnTimeChoices.map((choice, index) => (
                  <Button key={choice.instant.toISOString()} size="sm" variant="outline" onClick={() => void chooseReturnOccurrence(choice)}>
                    {index === 0 ? "First" : "Second"} ({choice.utcOffset})
                  </Button>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {returnTimeMessage ?? "Stored as an absolute deadline on this phone. When time passes, navigation shows OVERDUE."}
            </p>
            {alarmRefused && (
              <p className="text-xs font-medium text-destructive">
                This phone refused the return-time alarm, so nothing will wake you
                with the screen locked. Turn on Notifications for Klandagi in
                Settings. The in-app OVERDUE warning still works whenever the app
                is open.
              </p>
            )}
          </div>

          <div className="rounded-lg border p-3 space-y-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              ICE / medical (on device)
            </p>
            {profileSaveFailed && (
              <p className="text-xs text-destructive">
                NOT SAVED — this phone refused to store these details, so they will be gone
                on next launch. Free up storage, or write them on the paper backup.
              </p>
            )}
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

/** Returns "" for an unparseable stored value; "NaN-NaN-NaNTNaN:NaN" is truthy and
 *  used to reach `new Date(...).toISOString()`, which throws and takes the screen down. */
function toLocalInput(iso: string) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
