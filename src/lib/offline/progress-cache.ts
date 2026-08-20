import {
  remainingElevationGain,
  resolveRemaining,
  stabilizeLoop,
  type LatLng,
  type TrailProgress,
  type TravelDirection,
} from "@/lib/geo/navigation";
import type { RoutePack } from "@/lib/offline/route-pack";

interface Segment {
  start: GeoJSON.Position;
  end: GeoJSON.Position;
  startMeters: number;
  endMeters: number;
}

export function routePackFingerprint(pack: RoutePack): string {
  return `${pack.id}:${pack.cachedAt}:${pack.lengthMeters}:${pack.cumulativeDistancesMeters.length}`;
}

export interface RouteProgressCache {
  packId: string;
  fingerprint: string;
  totalMeters: number;
  elevationProfile: RoutePack["elevationProfile"];
  segments: Segment[];
  segmentCells: Map<string, number[]>;
  hasUnindexedSegments: boolean;
  lastSegment: number | null;
  lastTraveledMeters: number | null;
}

const LOCAL_SEGMENT_WINDOW = 512;
const LOCAL_SEARCH_ESCAPE_METERS = 250;
const GRID_CELL_DEGREES = 0.01;
const MAX_INDEXED_CELLS_PER_SEGMENT = 100;
const SPATIAL_SEARCH_ESCAPE_METERS = 750;

function lines(geometry: RoutePack["geometry"]): GeoJSON.Position[][] {
  return geometry.type === "LineString" ? [geometry.coordinates] : geometry.coordinates;
}

/** Build the segment index once when a validated pack is opened, never per GPS fix. */
export function createRouteProgressCache(pack: RoutePack): RouteProgressCache {
  const segments: Segment[] = [];
  const segmentCells = new Map<string, number[]>();
  let hasUnindexedSegments = false;
  let coordinateIndex = 0;
  for (const line of lines(pack.geometry)) {
    for (let index = 1; index < line.length; index += 1) {
      const segmentIndex = segments.length;
      const segment = {
        start: line[index - 1], end: line[index],
        startMeters: pack.cumulativeDistancesMeters[coordinateIndex + index - 1],
        endMeters: pack.cumulativeDistancesMeters[coordinateIndex + index],
      };
      segments.push(segment);
      const minLng = Math.min(Number(segment.start[0]), Number(segment.end[0]));
      const maxLng = Math.max(Number(segment.start[0]), Number(segment.end[0]));
      const minLat = Math.min(Number(segment.start[1]), Number(segment.end[1]));
      const maxLat = Math.max(Number(segment.start[1]), Number(segment.end[1]));
      const minX = Math.floor(minLng / GRID_CELL_DEGREES), maxX = Math.floor(maxLng / GRID_CELL_DEGREES);
      const minY = Math.floor(minLat / GRID_CELL_DEGREES), maxY = Math.floor(maxLat / GRID_CELL_DEGREES);
      if ((maxX - minX + 1) * (maxY - minY + 1) > MAX_INDEXED_CELLS_PER_SEGMENT) {
        hasUnindexedSegments = true;
      } else {
        for (let x = minX; x <= maxX; x += 1) for (let y = minY; y <= maxY; y += 1) {
          const key = `${x}:${y}`;
          const bucket = segmentCells.get(key) ?? [];
          bucket.push(segmentIndex);
          segmentCells.set(key, bucket);
        }
      }
    }
    coordinateIndex += line.length;
  }
  return { packId: pack.id, fingerprint: routePackFingerprint(pack), totalMeters: pack.lengthMeters, elevationProfile: pack.elevationProfile, segments, segmentCells, hasUnindexedSegments, lastSegment: null, lastTraveledMeters: null };
}

function wrappedLongitudeDelta(lng: number): number {
  return ((lng + 540) % 360) - 180;
}

function bearing(from: LatLng, to: LatLng): number {
  const radians = Math.PI / 180;
  const lat1 = from.lat * radians;
  const lat2 = to.lat * radians;
  const deltaLng = wrappedLongitudeDelta(to.lng - from.lng) * radians;
  const y = Math.sin(deltaLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function nearestOnSegment(point: LatLng, segment: Segment) {
  const latitudeScale = 111_320;
  const longitudeScale = latitudeScale * Math.cos(point.lat * Math.PI / 180);
  const ax = wrappedLongitudeDelta(Number(segment.start[0]) - point.lng) * longitudeScale;
  const ay = (Number(segment.start[1]) - point.lat) * latitudeScale;
  const bx = wrappedLongitudeDelta(Number(segment.end[0]) - point.lng) * longitudeScale;
  const by = (Number(segment.end[1]) - point.lat) * latitudeScale;
  const dx = bx - ax;
  const dy = by - ay;
  const denominator = dx * dx + dy * dy;
  const fraction = denominator > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / denominator)) : 0;
  const x = ax + fraction * dx;
  const y = ay + fraction * dy;
  return {
    distanceMeters: Math.hypot(x, y),
    fraction,
    nearest: {
      lng: point.lng + x / longitudeScale,
      lat: point.lat + y / latitudeScale,
    },
  };
}

function validPoint(point: LatLng): boolean {
  return Number.isFinite(point.lat) && Number.isFinite(point.lng) && point.lat >= -90 && point.lat <= 90 && point.lng >= -180 && point.lng <= 180;
}

function emptyProgress(point: LatLng, totalMeters: number, valid: boolean): TrailProgress {
  return {
    nearest: point,
    offsetMeters: Number.NaN,
    traveledMeters: 0,
    remainingMeters: totalMeters,
    totalMeters,
    remainingElevationMeters: 0,
    remainingDirection: "unknown",
    bearingToTrail: Number.NaN,
    valid,
  };
}

/**
 * Scans a small continuity window after the first fix. If the hiker moves far
 * from that window (or the route branches), it falls back to all segments once
 * rather than returning a potentially wrong nearest route segment.
 */
export function progressWithRouteCache(
  cache: RouteProgressCache,
  point: LatLng,
  direction: TravelDirection = "forward",
): TrailProgress {
  if (!validPoint(point) || cache.segments.length === 0) return emptyProgress(validPoint(point) ? point : { lat: 0, lng: 0 }, cache.totalMeters, false);
  const search = (start: number, end: number) => {
    let best: { index: number; distanceMeters: number; fraction: number; nearest: LatLng } | null = null;
    for (let index = start; index < end; index += 1) {
      const result = nearestOnSegment(point, cache.segments[index]);
      if (!best || result.distanceMeters < best.distanceMeters) best = { index, ...result };
    }
    return best;
  };
  let best: { index: number; distanceMeters: number; fraction: number; nearest: LatLng } | null = null;
  if (cache.lastSegment != null) {
    const localStart = Math.max(0, cache.lastSegment - LOCAL_SEGMENT_WINDOW);
    const localEnd = Math.min(cache.segments.length, cache.lastSegment + LOCAL_SEGMENT_WINDOW + 1);
    best = search(localStart, localEnd);
  } else if (!cache.hasUnindexedSegments) {
    const x = Math.floor(point.lng / GRID_CELL_DEGREES), y = Math.floor(point.lat / GRID_CELL_DEGREES);
    const candidates = new Set<number>();
    for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) {
      for (const index of cache.segmentCells.get(`${x + dx}:${y + dy}`) ?? []) candidates.add(index);
    }
    for (const index of candidates) {
      const result = nearestOnSegment(point, cache.segments[index]);
      if (!best || result.distanceMeters < best.distanceMeters) best = { index, ...result };
    }
  }
  if (!best || best.distanceMeters > (cache.lastSegment == null ? SPATIAL_SEARCH_ESCAPE_METERS : LOCAL_SEARCH_ESCAPE_METERS)) {
    best = search(0, cache.segments.length)!;
  }
  cache.lastSegment = best.index;
  const segment = cache.segments[best.index];
  const traveledMeters = Math.max(0, Math.min(cache.totalMeters, segment.startMeters + (segment.endMeters - segment.startMeters) * best.fraction));
  const { remainingMeters, resolvedDirection } = resolveRemaining(
    traveledMeters,
    cache.totalMeters,
    direction,
  );
  const progress = stabilizeLoop({
    nearest: best.nearest,
    offsetMeters: best.distanceMeters,
    traveledMeters,
    remainingMeters,
    totalMeters: cache.totalMeters,
    remainingElevationMeters: remainingElevationGain(
      cache.elevationProfile,
      traveledMeters,
      resolvedDirection,
    ),
    remainingDirection: direction,
    bearingToTrail: bearing(point, best.nearest),
    valid: true,
  }, cache.lastTraveledMeters != null ? { traveledMeters: cache.lastTraveledMeters } : null);
  cache.lastTraveledMeters = progress.traveledMeters;
  return progress;
}
