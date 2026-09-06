import { bboxFromGeometry } from "@/lib/geo";

/**
 * Offline corridor context.
 *
 * The route-only Safety Map answers "am I on my line?". It cannot answer the
 * question a hiker actually has once they are off it: what is around me, and
 * which way is out. This module carries a bounded set of surrounding features --
 * nearby trails, roads, water, shelters, campsites -- into the offline pack so
 * that question is answerable with no network and no map tiles.
 *
 * Two rules govern everything here:
 *
 * 1. The corridor is additive. It must never be able to prevent a route pack
 *    from being saved, and its absence must never degrade route navigation. The
 *    route remains the guaranteed Safety Map.
 * 2. Coverage is stated, never implied. A partial or failed corridor fetch is
 *    reported as partial or failed. Blank space on the map must mean "not
 *    downloaded", not "nothing there", and the two are indistinguishable to a
 *    hiker unless we say which one it is.
 */

export const DEFAULT_CORRIDOR_METERS = 3218.688; // 2 miles
export const MAX_CORRIDOR_METERS = 16093.44; // 10 miles

/**
 * Caps exist because this payload shares the 16 MB route-pack budget with the
 * route itself. If a corridor would exceed them we degrade the corridor, never
 * the route.
 */
export const MAX_CORRIDOR_FEATURES = 4_000;
export const MAX_CORRIDOR_POSITIONS = 60_000;
export const MAX_CORRIDOR_BYTES = 4 * 1024 * 1024;

/** Feature classes a hiker can act on when off-route. Ordered by escape value. */
export const CORRIDOR_KINDS = [
  "road",
  "track",
  "trail",
  "water",
  "shelter",
  "campsite",
  "building",
  "barrier",
] as const;
export type CorridorKind = (typeof CORRIDOR_KINDS)[number];

export interface CorridorLine {
  kind: Extract<CorridorKind, "road" | "track" | "trail" | "water" | "barrier">;
  name?: string;
  positions: GeoJSON.Position[];
}

export interface CorridorPoint {
  kind: Extract<CorridorKind, "water" | "shelter" | "campsite" | "building">;
  name?: string;
  lat: number;
  lng: number;
}

/**
 * `complete` means the corridor covers the whole stated buffer. `partial` means
 * some of it is missing -- usually because a cap was hit or one source failed --
 * and the user is told so. `failed` means nothing usable was retrieved.
 */
export type CorridorCoverage = "complete" | "partial" | "failed";

export interface OfflineCorridor {
  bufferMeters: number;
  bbox: [number, number, number, number];
  lines: CorridorLine[];
  points: CorridorPoint[];
  coverage: CorridorCoverage;
  /** Present when coverage is not complete. Shown to the user verbatim. */
  note?: string;
  retrievedAt: string;
}

function finitePosition(position: unknown): position is GeoJSON.Position {
  return (
    Array.isArray(position) &&
    position.length >= 2 &&
    Number.isFinite(position[0]) &&
    Number.isFinite(position[1]) &&
    Number(position[0]) >= -180 &&
    Number(position[0]) <= 180 &&
    Number(position[1]) >= -90 &&
    Number(position[1]) <= 90
  );
}

function cleanName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  // Control characters are stripped rather than escaped: these labels are drawn
  // to a canvas and printed onto paper backups, and neither context has a way to
  // render them safely or a reason to preserve them.
  const trimmed = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim().slice(0, 80);
  return trimmed.length > 0 ? trimmed : undefined;
}

function isLineKind(value: unknown): value is CorridorLine["kind"] {
  return value === "road" || value === "track" || value === "trail" || value === "water" || value === "barrier";
}

function isPointKind(value: unknown): value is CorridorPoint["kind"] {
  return value === "water" || value === "shelter" || value === "campsite" || value === "building";
}

/**
 * Escape value, lowest number kept first.
 *
 * Truncation used to follow arrival order, which meant whatever Overpass happened
 * to return first survived. Measured against a real corridor, generic structures
 * outnumbered roads six to one, so arrival order would quietly spend the storage
 * budget on buildings and drop the road the hiker needs to walk out on. A road is
 * kept over a building every time.
 */
const LINE_PRIORITY: Record<CorridorLine["kind"], number> = {
  road: 0,
  water: 1,
  track: 2,
  trail: 3,
  barrier: 4,
};

const POINT_PRIORITY: Record<CorridorPoint["kind"], number> = {
  shelter: 0,
  water: 1,
  campsite: 2,
  building: 3,
};

/**
 * Computes the corridor bounds for a route.
 *
 * Longitude padding is scaled by latitude. Using a flat degree padding would
 * silently shrink the real-world corridor toward the poles, so a hiker at 68°N
 * would be shown a "2 mile corridor" that was closer to three quarters of a
 * mile wide.
 */
export function corridorBounds(
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString,
  bufferMeters: number = DEFAULT_CORRIDOR_METERS,
): { bbox: [number, number, number, number]; bufferMeters: number } | null {
  const buffer =
    Number.isFinite(bufferMeters) && bufferMeters > 0
      ? Math.min(bufferMeters, MAX_CORRIDOR_METERS)
      : DEFAULT_CORRIDOR_METERS;
  const latPadding = buffer / 111_320;
  const base = bboxFromGeometry(geometry, 0);
  if (!base) return null;
  const midLat = (base[1] + base[3]) / 2;
  const cosLat = Math.cos((midLat * Math.PI) / 180);
  // Near the poles cos(lat) approaches zero and the longitude padding would
  // explode. Clamp to a floor and let the bbox clamp below bound the result.
  const lngPadding = latPadding / Math.max(0.05, Math.abs(cosLat));
  const bbox: [number, number, number, number] = [
    Math.max(-180, base[0] - lngPadding),
    Math.max(-90, base[1] - latPadding),
    Math.min(180, base[2] + lngPadding),
    Math.min(90, base[3] + latPadding),
  ];
  if (!bbox.every(Number.isFinite) || bbox[0] > bbox[2] || bbox[1] > bbox[3]) return null;
  return { bbox, bufferMeters: buffer };
}

export function corridorCoverageLabel(corridor: OfflineCorridor | null | undefined): string {
  if (!corridor) return "Route line only — no surrounding terrain saved";
  const miles = corridor.bufferMeters / 1609.344;
  const width = miles < 1 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`;
  if (corridor.coverage === "failed") {
    return `Route line only — ${width} corridor could not be downloaded`;
  }
  if (corridor.coverage === "partial") {
    return `Route + partial ${width} corridor`;
  }
  return `Route + ${width} corridor`;
}

/** Total stored positions, used for the cap and for storage reporting. */
export function corridorPositionCount(corridor: OfflineCorridor): number {
  return corridor.lines.reduce((total, line) => total + line.positions.length, 0) + corridor.points.length;
}

/**
 * Normalizes untrusted corridor data into a payload that is safe to store and
 * draw.
 *
 * Anything unusable is dropped rather than repaired, and dropping something
 * downgrades coverage to `partial` so the map's blank space is explained. A
 * silent drop would leave the hiker believing a road they can see on the screen
 * is the only road there is.
 */
export function normalizeCorridor(input: {
  bufferMeters: number;
  bbox: [number, number, number, number];
  lines?: unknown;
  points?: unknown;
  coverage?: CorridorCoverage;
  note?: string;
  retrievedAt?: string;
}): OfflineCorridor {
  const rawLines = Array.isArray(input.lines) ? input.lines : [];
  const rawPoints = Array.isArray(input.points) ? input.points : [];
  let dropped = 0;
  let truncated = false;

  // Sorted before any cap is applied so the features that survive truncation are
  // the ones worth surviving. Unknown kinds sort last and are rejected below.
  const sortedLines = [...rawLines].sort((a, b) => {
    const left = LINE_PRIORITY[(a as CorridorLine)?.kind] ?? 99;
    const right = LINE_PRIORITY[(b as CorridorLine)?.kind] ?? 99;
    return left - right;
  });
  const sortedPoints = [...rawPoints].sort((a, b) => {
    const left = POINT_PRIORITY[(a as CorridorPoint)?.kind] ?? 99;
    const right = POINT_PRIORITY[(b as CorridorPoint)?.kind] ?? 99;
    return left - right;
  });

  /*
   * Feature budget.
   *
   * Reserving space for every raw point before processing lines meant a corridor
   * dense in structures could starve the road network entirely. Points instead get
   * a guaranteed minimum share -- enough that shelters and water are never
   * squeezed out by a dense trail network -- and lines get the rest.
   */
  const pointReserve = Math.min(sortedPoints.length, Math.floor(MAX_CORRIDOR_FEATURES * 0.25));
  const lineBudget = MAX_CORRIDOR_FEATURES - pointReserve;

  const lines: CorridorLine[] = [];
  let positions = 0;
  for (const candidate of sortedLines) {
    if (lines.length >= lineBudget || positions >= MAX_CORRIDOR_POSITIONS) {
      truncated = true;
      break;
    }
    const record = candidate as Partial<CorridorLine>;
    if (!isLineKind(record?.kind) || !Array.isArray(record.positions)) {
      dropped += 1;
      continue;
    }
    const clean = record.positions.filter(finitePosition).map((position) => [
      Number(position[0]),
      Number(position[1]),
    ] as GeoJSON.Position);
    // A one-point line cannot be drawn and cannot be followed.
    if (clean.length < 2) {
      dropped += 1;
      continue;
    }
    if (clean.length !== record.positions.length) dropped += 1;
    lines.push({ kind: record.kind, name: cleanName(record.name), positions: clean });
    positions += clean.length;
  }

  const points: CorridorPoint[] = [];
  for (const candidate of sortedPoints) {
    if (lines.length + points.length >= MAX_CORRIDOR_FEATURES) {
      truncated = true;
      break;
    }
    const record = candidate as Partial<CorridorPoint>;
    if (!isPointKind(record?.kind) || !Number.isFinite(record.lat) || !Number.isFinite(record.lng)) {
      dropped += 1;
      continue;
    }
    const lat = Number(record.lat);
    const lng = Number(record.lng);
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      dropped += 1;
      continue;
    }
    points.push({ kind: record.kind, name: cleanName(record.name), lat, lng });
  }

  const retrievedAtRaw = typeof input.retrievedAt === "string" ? Date.parse(input.retrievedAt) : Number.NaN;
  const retrievedAt = Number.isFinite(retrievedAtRaw)
    ? new Date(retrievedAtRaw).toISOString()
    : new Date().toISOString();

  const empty = lines.length === 0 && points.length === 0;
  let coverage: CorridorCoverage = input.coverage ?? "complete";
  if (empty) coverage = "failed";
  else if (truncated || dropped > 0 || coverage === "partial") coverage = "partial";

  const notes: string[] = [];
  if (input.note) notes.push(input.note);
  if (truncated) notes.push("The corridor was trimmed to fit offline storage limits.");
  if (dropped > 0) notes.push(`${dropped} corridor feature${dropped === 1 ? "" : "s"} could not be read and were left out.`);
  if (empty) notes.push("No surrounding features were retrieved. Navigate from the route line, compass and paper backup.");

  return {
    bufferMeters:
      Number.isFinite(input.bufferMeters) && input.bufferMeters > 0
        ? Math.min(input.bufferMeters, MAX_CORRIDOR_METERS)
        : DEFAULT_CORRIDOR_METERS,
    bbox: input.bbox,
    lines,
    points,
    coverage,
    note: notes.length > 0 ? notes.join(" ") : undefined,
    retrievedAt,
  };
}

/**
 * Persistence-boundary check. Returns a user-safe reason string, or null when the
 * corridor is safe to store, mirroring `validateRoutePack`.
 */
export function corridorValidationError(corridor: unknown): string | null {
  if (corridor === undefined) return null;
  if (!corridor || typeof corridor !== "object") return "Saved corridor data is invalid.";
  const candidate = corridor as OfflineCorridor;
  if (!Number.isFinite(candidate.bufferMeters) || candidate.bufferMeters <= 0 || candidate.bufferMeters > MAX_CORRIDOR_METERS) {
    return "Saved corridor width is invalid.";
  }
  if (
    !Array.isArray(candidate.bbox) ||
    candidate.bbox.length !== 4 ||
    !candidate.bbox.every(Number.isFinite) ||
    candidate.bbox[0] < -180 ||
    candidate.bbox[2] > 180 ||
    candidate.bbox[1] < -90 ||
    candidate.bbox[3] > 90 ||
    candidate.bbox[0] > candidate.bbox[2] ||
    candidate.bbox[1] > candidate.bbox[3]
  ) {
    return "Saved corridor bounds are invalid.";
  }
  if (!Array.isArray(candidate.lines) || !Array.isArray(candidate.points)) return "Saved corridor data is invalid.";
  if (candidate.coverage !== "complete" && candidate.coverage !== "partial" && candidate.coverage !== "failed") {
    return "Saved corridor coverage state is invalid.";
  }
  if (candidate.lines.length + candidate.points.length > MAX_CORRIDOR_FEATURES) return "Saved corridor has too many features.";
  if (corridorPositionCount(candidate) > MAX_CORRIDOR_POSITIONS) return "Saved corridor has too many points.";
  for (const line of candidate.lines) {
    if (!isLineKind(line?.kind) || !Array.isArray(line.positions) || line.positions.length < 2) return "Saved corridor line is invalid.";
    if (!line.positions.every(finitePosition)) return "Saved corridor line has an invalid position.";
  }
  for (const point of candidate.points) {
    if (!isPointKind(point?.kind) || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return "Saved corridor point is invalid.";
  }
  const retrievedAt = Date.parse(candidate.retrievedAt);
  if (!Number.isFinite(retrievedAt)) return "Saved corridor timestamp is invalid.";
  if (candidate.note !== undefined && typeof candidate.note !== "string") return "Saved corridor note is invalid.";
  try {
    if (new TextEncoder().encode(JSON.stringify(candidate)).byteLength > MAX_CORRIDOR_BYTES) {
      return "Saved corridor data is too large.";
    }
  } catch {
    return "Saved corridor data cannot be read.";
  }
  return null;
}
