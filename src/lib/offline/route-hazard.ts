export interface RouteSamplePoint {
  distanceMeters: number;
  lat: number;
  lng: number;
}

export interface HazardObservation {
  sampleDistanceMeters: number;
  kind: "weather" | "heat" | "cold" | "wind" | "lightning" | "smoke" | "closure" | "water" | "custom";
  severity: "info" | "watch" | "critical";
  title: string;
  detail?: string;
  observedAt?: string;
  source: string;
}

function haversineMeters(a: [number, number], b: [number, number]): number {
  const r = 6_371_000;
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad;
  const dLng = (b[0] - a[0]) * toRad;
  const lat1 = a[1] * toRad;
  const lat2 = b[1] * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

function coordinates(geometry: GeoJSON.LineString | GeoJSON.MultiLineString): GeoJSON.Position[] {
  return geometry.type === "LineString" ? geometry.coordinates : geometry.coordinates.flat();
}

/**
 * Samples by route distance, not by coordinate index, so dense GPX segments do not
 * accidentally dominate the briefing. Returned points are deterministic and offline-safe.
 */
export function sampleRouteByDistance(
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString,
  intervalMeters = 5000,
): RouteSamplePoint[] {
  if (!Number.isFinite(intervalMeters) || intervalMeters <= 0) throw new Error("Sampling interval must be positive.");
  const coords = coordinates(geometry);
  if (coords.length < 2) return [];
  const cumulative = [0];
  for (let i = 1; i < coords.length; i += 1) {
    cumulative.push(cumulative[i - 1] + haversineMeters([coords[i - 1][0], coords[i - 1][1]], [coords[i][0], coords[i][1]]));
  }
  const total = cumulative.at(-1) ?? 0;
  const targets: number[] = [0];
  for (let d = intervalMeters; d < total; d += intervalMeters) targets.push(d);
  if (total > 0) targets.push(total);

  return targets.map((target) => {
    let i = 1;
    while (i < cumulative.length && cumulative[i] < target) i += 1;
    const prev = Math.max(0, i - 1);
    const span = cumulative[i] - cumulative[prev] || 1;
    const t = Math.min(1, Math.max(0, (target - cumulative[prev]) / span));
    const a = coords[prev];
    const b = coords[i];
    return {
      distanceMeters: target,
      lng: a[0] + (b[0] - a[0]) * t,
      lat: a[1] + (b[1] - a[1]) * t,
    };
  });
}

export function summarizeHazards(observations: HazardObservation[]): {
  critical: number;
  watch: number;
  info: number;
  highest: "critical" | "watch" | "info" | "none";
} {
  const counts = { critical: 0, watch: 0, info: 0 };
  for (const observation of observations) counts[observation.severity] += 1;
  return {
    ...counts,
    highest: counts.critical ? "critical" : counts.watch ? "watch" : counts.info ? "info" : "none",
  };
}
