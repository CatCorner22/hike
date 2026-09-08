export type RouteEvidenceState = "measured" | "reported" | "unknown";

export interface RouteDifficultyFactor {
  id:
    | "distance"
    | "elevation"
    | "grade"
    | "altitude"
    | "technical"
    | "route-finding"
    | "crossings"
    | "exposure"
    | "shade"
    | "water"
    | "daylight";
  label: string;
  state: RouteEvidenceState;
  value: string;
  detail: string;
  source: string;
}

export interface RouteDifficultySnapshot {
  factors: RouteDifficultyFactor[];
  knownCount: number;
  unknownCount: number;
}

type ElevationSample = { distanceMeters: number; elevation: number };

const FEET_PER_METER = 3.28084;
const MILES_PER_METER = 0.000621371;
const SUSTAINED_GRADE_SPAN_M = 400;

function rounded(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function miles(meters: number): string {
  return `${(meters * MILES_PER_METER).toFixed(meters >= 16_093 ? 1 : 2)} mi`;
}

function feet(meters: number): string {
  return `${rounded(meters * FEET_PER_METER)} ft`;
}

function percent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function cleanTag(value: string | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 120);
  return cleaned || null;
}

function cleanProfile(profile: ElevationSample[]): ElevationSample[] {
  const byDistance = new Map<number, number>();
  for (const sample of profile) {
    if (
      !Number.isFinite(sample.distanceMeters) ||
      !Number.isFinite(sample.elevation) ||
      sample.distanceMeters < 0 ||
      sample.elevation < -500 ||
      sample.elevation > 9_000
    ) continue;
    byDistance.set(sample.distanceMeters, sample.elevation);
  }
  return [...byDistance.entries()]
    .sort(([a], [b]) => a - b)
    .map(([distanceMeters, elevation]) => ({ distanceMeters, elevation }));
}

function elevationFacts(profile: ElevationSample[]) {
  const clean = cleanProfile(profile);
  if (clean.length < 2 || clean[clean.length - 1].distanceMeters <= clean[0].distanceMeters) {
    return null;
  }

  let ascentM = 0;
  let descentM = 0;
  let maximumAbsGrade = 0;
  let sustainedAbsGrade: number | null = null;

  for (let index = 1; index < clean.length; index++) {
    const distance = clean[index].distanceMeters - clean[index - 1].distanceMeters;
    const elevation = clean[index].elevation - clean[index - 1].elevation;
    if (!(distance > 0)) continue;
    if (elevation > 0) ascentM += elevation;
    else descentM += Math.abs(elevation);
    maximumAbsGrade = Math.max(maximumAbsGrade, Math.abs(elevation / distance) * 100);
  }

  for (let start = 0; start < clean.length - 1; start++) {
    for (let end = start + 1; end < clean.length; end++) {
      const distance = clean[end].distanceMeters - clean[start].distanceMeters;
      if (distance < SUSTAINED_GRADE_SPAN_M) continue;
      const grade = Math.abs((clean[end].elevation - clean[start].elevation) / distance) * 100;
      sustainedAbsGrade = Math.max(sustainedAbsGrade ?? 0, grade);
    }
  }

  const elevations = clean.map((sample) => sample.elevation);
  return {
    ascentM,
    descentM,
    maximumAbsGrade,
    sustainedAbsGrade,
    minimumElevationM: Math.min(...elevations),
    maximumElevationM: Math.max(...elevations),
  };
}

function reportedTechnical(tags: Record<string, string>): RouteDifficultyFactor {
  const sacScale = cleanTag(tags.sac_scale);
  const surface = cleanTag(tags.surface);
  const smoothness = cleanTag(tags.smoothness);
  const pieces = [
    sacScale ? `SAC ${sacScale.replaceAll("_", " ")}` : null,
    surface ? `surface ${surface.replaceAll("_", " ")}` : null,
    smoothness ? `smoothness ${smoothness.replaceAll("_", " ")}` : null,
  ].filter((piece): piece is string => Boolean(piece));
  if (pieces.length === 0) {
    return {
      id: "technical",
      label: "Technical terrain",
      state: "unknown",
      value: "Not mapped",
      detail: "No SAC scale, surface, or smoothness tag is present for the route. This is not evidence of easy footing.",
      source: "OpenStreetMap route metadata",
    };
  }
  return {
    id: "technical",
    label: "Technical terrain",
    state: "reported",
    value: pieces.join(" · "),
    detail: "Community-mapped route tags can be incomplete or stale; verify current footing and required skills locally.",
    source: "OpenStreetMap route metadata",
  };
}

function reportedTagFactor(input: {
  id: RouteDifficultyFactor["id"];
  label: string;
  value?: string;
  unknown: string;
  caveat: string;
}): RouteDifficultyFactor {
  const value = cleanTag(input.value);
  return value
    ? {
        id: input.id,
        label: input.label,
        state: "reported",
        value: value.replaceAll("_", " "),
        detail: input.caveat,
        source: "OpenStreetMap route metadata",
      }
    : {
        id: input.id,
        label: input.label,
        state: "unknown",
        value: "Unknown",
        detail: input.unknown,
        source: "No route-level evidence",
      };
}

/**
 * Deterministic route evidence, deliberately without an overall score.
 *
 * The returned factors separate measurements, third-party reports, and unknowns
 * so callers cannot turn missing evidence into an implied "easy" rating.
 */
export function buildRouteDifficultySnapshot(input: {
  geometryDistanceMeters?: number | null;
  reportedDistanceMeters?: number | null;
  elevationProfile?: ElevationSample[];
  tags?: Record<string, string>;
  daylightSummary?: string | null;
}): RouteDifficultySnapshot {
  const tags = input.tags ?? {};
  const measuredDistance =
    input.geometryDistanceMeters != null && Number.isFinite(input.geometryDistanceMeters) && input.geometryDistanceMeters > 0
      ? input.geometryDistanceMeters
      : null;
  const reportedDistance =
    input.reportedDistanceMeters != null && Number.isFinite(input.reportedDistanceMeters) && input.reportedDistanceMeters > 0
      ? input.reportedDistanceMeters
      : null;
  const profile = elevationFacts(input.elevationProfile ?? []);

  const distance: RouteDifficultyFactor = measuredDistance != null
    ? {
        id: "distance",
        label: "Route distance",
        state: "measured",
        value: miles(measuredDistance),
        detail: reportedDistance != null && Math.abs(reportedDistance - measuredDistance) / measuredDistance > 0.08
          ? `Geometry measurement; the mapped route also reports ${miles(reportedDistance)}. Investigate the difference before departure.`
          : "Measured along the stored route geometry; detours and GPS variation can add distance.",
        source: "Stored route geometry",
      }
    : reportedDistance != null
      ? {
          id: "distance",
          label: "Route distance",
          state: "reported",
          value: miles(reportedDistance),
          detail: "Reported in route metadata; the app could not independently measure route geometry.",
          source: "OpenStreetMap route metadata",
        }
      : {
          id: "distance",
          label: "Route distance",
          state: "unknown",
          value: "Unknown",
          detail: "No valid route length is available.",
          source: "No route measurement",
        };

  const factors: RouteDifficultyFactor[] = [
    distance,
    profile
      ? {
          id: "elevation",
          label: "Climbing and descent",
          state: "measured",
          value: `+${feet(profile.ascentM)} / −${feet(profile.descentM)}`,
          detail: "Calculated from sampled elevations. Sparse or noisy terrain samples can understate or overstate cumulative change.",
          source: "Route elevation samples",
        }
      : {
          id: "elevation",
          label: "Climbing and descent",
          state: "unknown",
          value: "Unknown",
          detail: "At least two valid elevation samples are required; missing elevation does not mean a flat route.",
          source: "No usable elevation profile",
        },
    profile
      ? {
          id: "grade",
          label: "Steepness",
          state: "measured",
          value: profile.sustainedAbsGrade == null
            ? `sample-to-sample max ${percent(profile.maximumAbsGrade)}`
            : `max ${percent(profile.maximumAbsGrade)} · sustained ${percent(profile.sustainedAbsGrade)}`,
          detail: profile.sustainedAbsGrade == null
            ? `No pair of samples spans ${SUSTAINED_GRADE_SPAN_M} m, so sustained grade is unknown.`
            : `Sustained means the largest absolute net grade across a span of at least ${SUSTAINED_GRADE_SPAN_M} m. Short pitches between samples may be steeper.`,
          source: "Route elevation samples",
        }
      : {
          id: "grade",
          label: "Steepness",
          state: "unknown",
          value: "Unknown",
          detail: "No usable elevation profile is available; missing grade data does not mean gentle terrain.",
          source: "No usable elevation profile",
        },
    profile
      ? {
          id: "altitude",
          label: "Altitude range",
          state: "measured",
          value: `${feet(profile.minimumElevationM)}–${feet(profile.maximumElevationM)}`,
          detail: "Sampled route elevation range; this does not assess acclimatization or diagnose altitude illness.",
          source: "Route elevation samples",
        }
      : {
          id: "altitude",
          label: "Altitude range",
          state: "unknown",
          value: "Unknown",
          detail: "No usable elevation profile is available.",
          source: "No usable elevation profile",
        },
    reportedTechnical(tags),
    reportedTagFactor({
      id: "route-finding",
      label: "Route visibility",
      value: tags.trail_visibility,
      unknown: "No trail-visibility evidence is mapped. Carry a prepared route and independent navigation backup.",
      caveat: "A community-mapped visibility tag is not a guarantee that signs, tread, or markers are currently visible.",
    }),
    reportedTagFactor({
      id: "crossings",
      label: "Water crossings",
      value: tags.ford,
      unknown: "Route-level metadata does not establish whether water crossings exist or are safely passable.",
      caveat: "A route-level ford tag does not locate every crossing or report current depth and flow.",
    }),
    reportedTagFactor({
      id: "exposure",
      label: "Exposure",
      value: tags.exposure,
      unknown: "No route-level exposure evidence is available. Unknown is not the same as unexposed.",
      caveat: "This is a community-mapped label, not a complete field assessment.",
    }),
    reportedTagFactor({
      id: "shade",
      label: "Shade",
      value: tags.shade,
      unknown: "No route-level shade evidence is available; plan for sun and heat conservatively.",
      caveat: "Shade changes with season, time, fire, and vegetation; this tag may be incomplete.",
    }),
    reportedTagFactor({
      id: "water",
      label: "Drinking water",
      value: tags.drinking_water,
      unknown: "No route-level water evidence is available. Do not assume a source exists or is safe to drink.",
      caveat: "A mapped water tag does not establish current flow, quality, or treatment needs.",
    }),
    input.daylightSummary
      ? {
          id: "daylight",
          label: "Daylight margin",
          state: "measured",
          value: cleanTag(input.daylightSummary) ?? "Unavailable",
          detail: "Calculated from the selected date, departure, and planning pace; weather, stops, and route conditions can change actual time.",
          source: "Trip plan",
        }
      : {
          id: "daylight",
          label: "Daylight margin",
          state: "unknown",
          value: "Not calculated",
          detail: "Add the route to a plan, then set a date, departure time, and pace to calculate daylight margin.",
          source: "No complete trip timing plan",
        },
  ];

  const unknownCount = factors.filter((factor) => factor.state === "unknown").length;
  return { factors, knownCount: factors.length - unknownCount, unknownCount };
}
