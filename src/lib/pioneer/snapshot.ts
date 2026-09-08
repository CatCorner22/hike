import { hikeReadiness } from "@/lib/safety/readiness";
import { heatHazard, windChillHazard, type ThermalSeverity } from "@/lib/safety/field-ops";
import { hazardBriefFreshness } from "@/lib/offline/hazard-brief";
import { officialAlertFreshness } from "@/lib/offline/official-alerts";
import { packWeatherFreshness } from "@/lib/offline/pack-weather";
import type { RoutePack } from "@/lib/offline/route-pack";
import {
  researchBriefFieldTrust,
  researchFreshness,
  type TrailResearchBrief,
} from "@/lib/research/schema";
import type { IceProfile } from "@/lib/safety/profile";
import {
  pioneerOsmTagsSchema,
  pioneerSnapshotSchema,
  type PioneerOsmTags,
  type PioneerSnapshot,
} from "./schemas";

const OSM_ALLOWLIST = [
  "sac_scale",
  "difficulty",
  "hazard",
  "exposure",
  "ford",
  "permit",
  "dog",
] as const;

/** Strip coordinate-looking tokens before anything reaches a model prompt. */
export function redactNavMath(text: string): string {
  return text
    .replace(/\b-?\d{1,3}\.\d{3,}\b/g, "[redacted]")
    .replace(/\b\d{1,3}°(?:\s*\d{1,2}['′])?/g, "[redacted]");
}

export function osmTagsFromRecord(tags: Record<string, string> | null | undefined): PioneerOsmTags | undefined {
  if (!tags) return undefined;
  const picked: Record<string, string> = {};
  for (const key of OSM_ALLOWLIST) {
    const value = tags[key];
    if (typeof value === "string" && value.trim()) {
      picked[key] = redactNavMath(value.trim()).slice(0, key === "hazard" || key === "exposure" ? 200 : 80);
    }
  }
  const parsed = pioneerOsmTagsSchema.safeParse(picked);
  return parsed.success && Object.keys(parsed.data).length > 0 ? parsed.data : undefined;
}

export function researchSliceFromBrief(
  brief: TrailResearchBrief | null | undefined,
): PioneerSnapshot["research"] {
  if (!brief) {
    return {
      present: false,
      stale: true,
      provenance: "absent",
      hazardCount: 0,
      hazards: [],
      difficultyUnknown: true,
      parkingUnknown: true,
      permitsUnknown: true,
      conditionsUnknown: true,
      sourceCount: 0,
    };
  }
  const trust = researchBriefFieldTrust(brief);
  const freshness = researchFreshness(brief.lastResearchedAt);
  if (!trust.cacheReusable) {
    return {
      present: true,
      stale: true,
      provenance: "unverified",
      hazardCount: 0,
      hazards: [],
      difficultyUnknown: true,
      parkingUnknown: true,
      permitsUnknown: true,
      conditionsUnknown: true,
      sourceCount: 0,
    };
  }
  const hazards = trust.hazards
    ? brief.hazards.map((hazard) => redactNavMath(hazard).slice(0, 200)).filter(Boolean).slice(0, 8)
    : [];
  return {
    present: true,
    stale: freshness.stale,
    provenance: brief.provenance?.mode === "source_synthesis"
      ? "source_synthesis"
      : brief.provenance?.mode === "mapped_metadata_only"
        ? "mapped_metadata_only"
        : "unverified",
    hazardCount: hazards.length,
    hazards,
    difficultyUnknown: !trust.difficultyReality,
    parkingUnknown: !trust.parking,
    permitsUnknown: !trust.permits,
    conditionsUnknown: !trust.conditions,
    sourceCount: Math.min(20, trust.sourceUrls.length),
  };
}

function worseThermal(
  a: ThermalSeverity | "none",
  b: ThermalSeverity | "none",
): ThermalSeverity | "none" {
  const rank = { none: 0, info: 1, advisory: 2, danger: 3 } as const;
  return rank[a] >= rank[b] ? a : b;
}

function weatherSeverityFromPack(pack: RoutePack | null): PioneerSnapshot["pack"]["weatherSeverity"] {
  const weather = pack?.weather;
  if (!weather) return "none";
  const heat = typeof weather.tempC === "number" && typeof weather.rhPct === "number"
    ? heatHazard(weather.tempC, weather.rhPct)
    : null;
  const cold = typeof weather.tempC === "number" && typeof weather.windKph === "number"
    ? windChillHazard(weather.tempC, weather.windKph)
    : null;
  return worseThermal(heat?.severity ?? "none", cold?.severity ?? "none");
}

function freshnessKind(
  kind: "fresh" | "stale" | "unavailable" | "clock_error" | string,
): "fresh" | "stale" | "unavailable" {
  if (kind === "fresh") return "fresh";
  if (kind === "stale") return "stale";
  return "unavailable";
}

const ALERT_RANK: Record<PioneerSnapshot["pack"]["officialAlertMaxSeverity"], number> = {
  none: 0,
  unknown: 1,
  minor: 2,
  moderate: 3,
  severe: 4,
  extreme: 5,
};

export function packSliceFromRoutePack(
  pack: RoutePack | null,
  offline: { packReady: boolean; tripReady: boolean },
): PioneerSnapshot["pack"] {
  const weatherFreshness = packWeatherFreshness(pack?.weather);
  const briefFreshness = pack?.hazardBrief
    ? hazardBriefFreshness(pack.hazardBrief)
    : { kind: "unavailable" as const };
  const alertsFreshness = pack?.officialAlerts
    ? officialAlertFreshness(pack.officialAlerts)
    : "unavailable";
  let alertMax: PioneerSnapshot["pack"]["officialAlertMaxSeverity"] = "none";
  for (const alert of pack?.officialAlerts?.alerts ?? []) {
    const severity = alert.severity;
    if (severity in ALERT_RANK && ALERT_RANK[severity] > ALERT_RANK[alertMax]) {
      alertMax = severity;
    }
  }
  let briefSeverity: PioneerSnapshot["pack"]["hazardBriefSeverity"] = "none";
  for (const observation of pack?.hazardBrief?.observations ?? []) {
    if (observation.severity === "critical") briefSeverity = "critical";
    else if (observation.severity === "watch" && briefSeverity !== "critical") briefSeverity = "watch";
    else if (observation.severity === "info" && briefSeverity === "none") briefSeverity = "info";
  }
  return {
    packReady: offline.packReady,
    tripReady: offline.tripReady,
    corridorReady: Boolean(pack?.corridor && pack.corridorFeatures),
    weather: pack?.weather ? freshnessKind(weatherFreshness.kind) : "absent",
    weatherSeverity: weatherSeverityFromPack(pack),
    hazardBrief: pack?.hazardBrief ? freshnessKind(briefFreshness.kind) : "absent",
    hazardBriefSeverity: briefSeverity,
    officialAlerts: pack?.officialAlerts ? freshnessKind(alertsFreshness) : "absent",
    officialAlertCount: Math.min(40, pack?.officialAlerts?.alerts.length ?? 0),
    officialAlertMaxSeverity: alertMax,
    userBailoutCount: Math.min(20, pack?.bailoutRoutes?.length ?? 0),
  };
}

export function readinessSliceFromProfile(
  profile: IceProfile | null,
  returnAt: string | null,
  packReady: boolean,
): PioneerSnapshot["readiness"] {
  const result = hikeReadiness({
    packReady,
    profile: profile ?? { name: "", iceName: "", icePhone: "", medical: "", partySize: 1 },
    returnAt,
  });
  return {
    iceComplete: !result.missing.some((gap) =>
      gap.label === "your name"
      || gap.label === "an emergency contact name"
      || gap.label === "a working emergency contact number"
    ),
    returnAtSet: !result.missing.some((gap) => gap.label === "a planned return time"),
    gaps: result.missing.map((gap) => gap.label).slice(0, 8),
  };
}

export function assemblePioneerSnapshot(input: {
  trailName: string;
  osmTags?: Record<string, string> | null;
  brief?: TrailResearchBrief | null;
  pack?: RoutePack | null;
  packReady: boolean;
  tripReady: boolean;
  profile?: IceProfile | null;
  returnAt?: string | null;
  plan?: { notes?: string | null; waypoints?: unknown[] | null; plannedDate?: string | null };
}): PioneerSnapshot {
  return pioneerSnapshotSchema.parse({
    trailName: input.trailName.trim().slice(0, 200),
    osmTags: osmTagsFromRecord(input.osmTags),
    research: researchSliceFromBrief(input.brief),
    pack: packSliceFromRoutePack(input.pack ?? null, {
      packReady: input.packReady,
      tripReady: input.tripReady,
    }),
    readiness: readinessSliceFromProfile(
      input.profile ?? null,
      input.returnAt ?? null,
      input.packReady,
    ),
    ...(input.plan
      ? {
        plan: {
          hasNotes: Boolean(input.plan.notes?.trim()),
          waypointCount: Math.min(200, input.plan.waypoints?.length ?? 0),
          plannedDateSet: Boolean(input.plan.plannedDate),
        },
      }
      : {}),
  });
}
