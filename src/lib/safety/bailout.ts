import { lineLengthMeters, nearestPointOnTrail } from "@/lib/geo";
import { cumulativeDistancesForGeometry } from "@/lib/offline/route-pack";
import type { DecisionPoint } from "@/lib/safety/decision-support";

export interface BailoutCandidate {
  id: string;
  name: string;
  kind: "road" | "trailhead" | "shelter" | "developed" | "custom";
  lat: number;
  lng: number;
  routeDistanceMeters: number;
  exitDistanceMeters?: number;
  note?: string;
}

export function explicitBailoutCandidates(
  waypoints: Array<{ name: string; lat: number; lng: number; kind?: string }>,
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString,
): BailoutCandidate[] {
  const cumulative = cumulativeDistancesForGeometry(geometry);
  return waypoints
    .filter(
      (waypoint) => waypoint.kind === "bailout" || /^(bailout|exit):/i.test(waypoint.name.trim()),
    )
    .flatMap<BailoutCandidate>((waypoint, index) => {
      const snapped = nearestPointOnTrail(waypoint, geometry);
      if (!snapped || !Number.isFinite(snapped.distanceMeters)) return [];
      return [{
        id: `waypoint-bailout-${index}`,
        name: waypoint.name.replace(/^(bailout|exit):\s*/i, "") || waypoint.name,
        kind: "custom",
        lat: waypoint.lat,
        lng: waypoint.lng,
        routeDistanceMeters: Number.isFinite(snapped.alongMeters)
          ? snapped.alongMeters
          : cumulative[Math.min(snapped.index, Math.max(0, cumulative.length - 1))] ?? 0,
        note: "User-marked exit candidate. Verify the actual mapped path from the planned route before relying on it.",
      }];
    });
}

export function bailoutDecisionPoints(candidates: BailoutCandidate[]): DecisionPoint[] {
  return candidates
    .filter((candidate) => Number.isFinite(candidate.routeDistanceMeters) && candidate.routeDistanceMeters >= 0)
    .sort((a, b) => a.routeDistanceMeters - b.routeDistanceMeters)
    .map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      kind: candidate.kind === "shelter" ? "shelter" : candidate.kind === "road" ? "road" : "bailout",
      distanceMeters: candidate.routeDistanceMeters,
      lat: candidate.lat,
      lng: candidate.lng,
      note: candidate.exitDistanceMeters != null
        ? `${candidate.exitDistanceMeters.toFixed(0)} m from route to exit. ${candidate.note ?? ""}`.trim()
        : candidate.note,
    }));
}

/**
 * Rank already-derived bailout candidates. This module intentionally does not invent
 * off-network paths: route-finding to an exit must come from authoritative trail/road
 * geometry or a user-supplied GPX, never a straight-line shortcut.
 */
export function rankBailouts(input: {
  candidates: BailoutCandidate[];
  distanceTravelledMeters: number;
  maxAheadMeters?: number;
}): BailoutCandidate[] {
  const maxAhead = input.maxAheadMeters ?? 8000;
  return input.candidates
    .filter((candidate) => candidate.routeDistanceMeters >= input.distanceTravelledMeters)
    .filter((candidate) => candidate.routeDistanceMeters - input.distanceTravelledMeters <= maxAhead)
    .sort((a, b) => {
      const aExit = a.exitDistanceMeters ?? Number.POSITIVE_INFINITY;
      const bExit = b.exitDistanceMeters ?? Number.POSITIVE_INFINITY;
      if (aExit !== bExit) return aExit - bExit;
      return a.routeDistanceMeters - b.routeDistanceMeters;
    });
}

export function validateBailoutRoute(geometry: GeoJSON.LineString | GeoJSON.MultiLineString): string | null {
  const length = lineLengthMeters(geometry);
  if (!Number.isFinite(length) || length <= 0) return "Bailout route geometry is empty or invalid.";
  if (length > 100_000) return "Bailout route is implausibly long for an emergency exit and requires review.";
  return null;
}
