import { lineLengthMeters, nearestPointOnTrail, parseGpx } from "@/lib/geo";
import type { BailoutCandidate } from "@/lib/safety/bailout";

export const BAILOUT_ROUTE_DISCLAIMER =
  "User-supplied mapped path. Stored only because it meets the prepared route. No shortcut is invented.";

export const BAILOUT_JOIN_METERS = 80;
export const MAX_BAILOUT_ROUTES = 8;
export const MAX_BAILOUT_COORDINATES = 4_000;
export const MAX_BAILOUT_SET_BYTES = 256 * 1024;

export interface PreparedBailoutRoute {
  id: string;
  routeId: string;
  name: string;
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString;
  join: {
    lat: number;
    lng: number;
    alongMeters: number;
    offsetMeters: number;
  };
  lengthMeters: number;
  disclaimer: string;
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

function segments(geometry: GeoJSON.LineString | GeoJSON.MultiLineString): GeoJSON.Position[][] {
  const raw = geometry.type === "LineString" ? [geometry.coordinates] : geometry.coordinates;
  return raw
    .filter((line): line is GeoJSON.Position[] => Array.isArray(line) && line.length >= 2)
    .map((line) => line.filter(finitePosition))
    .filter((line) => line.length >= 2);
}

function positionCount(geometry: GeoJSON.LineString | GeoJSON.MultiLineString): number {
  return segments(geometry).reduce((count, line) => count + line.length, 0);
}

function validGeometry(geometry: unknown): geometry is GeoJSON.LineString | GeoJSON.MultiLineString {
  if (!geometry || typeof geometry !== "object") return false;
  const candidate = geometry as GeoJSON.LineString | GeoJSON.MultiLineString;
  if (candidate.type !== "LineString" && candidate.type !== "MultiLineString") return false;
  const lines = segments(candidate);
  return lines.length > 0 && positionCount(candidate) <= MAX_BAILOUT_COORDINATES;
}

function validName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 80 && !/[\u0000-\u001f\u007f]/.test(value);
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f\u007f]/.test(value);
}

export function findBailoutJoin(
  main: GeoJSON.LineString | GeoJSON.MultiLineString,
  bailout: GeoJSON.LineString | GeoJSON.MultiLineString,
): PreparedBailoutRoute["join"] | null {
  let best: PreparedBailoutRoute["join"] | null = null;
  for (const line of segments(bailout)) {
    for (const position of line) {
      const snapped = nearestPointOnTrail({ lng: position[0], lat: position[1] }, main);
      if (!snapped || !Number.isFinite(snapped.distanceMeters) || !Number.isFinite(snapped.alongMeters)) continue;
      if (!best || snapped.distanceMeters < best.offsetMeters) {
        best = {
          lat: snapped.lat,
          lng: snapped.lng,
          alongMeters: snapped.alongMeters,
          offsetMeters: snapped.distanceMeters,
        };
      }
    }
  }
  if (!best || best.offsetMeters > BAILOUT_JOIN_METERS) return null;
  return best;
}

function bailoutId(name: string, geometry: GeoJSON.LineString | GeoJSON.MultiLineString): string {
  const first = segments(geometry)[0]?.[0];
  const seed = `${name}-${first?.[0] ?? 0}-${first?.[1] ?? 0}-${positionCount(geometry)}`;
  return `gpx-${seed.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 100)}`;
}

export function prepareBailoutRoute(input: {
  routeId: string;
  name: string;
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString;
  main: GeoJSON.LineString | GeoJSON.MultiLineString;
}): { route: PreparedBailoutRoute } | { error: string } {
  if (!validId(input.routeId)) return { error: "Route id is invalid." };
  const name = input.name.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!validName(name)) return { error: "Bailout name is invalid." };
  if (!validGeometry(input.geometry)) {
    return { error: "Bailout GPX is missing, too dense, or not a usable track." };
  }
  const lengthMeters = lineLengthMeters(input.geometry);
  if (!Number.isFinite(lengthMeters) || lengthMeters <= 0) {
    return { error: "Bailout route geometry is empty or invalid." };
  }
  if (lengthMeters > 100_000) {
    return { error: "Bailout route is implausibly long for an emergency exit and requires review." };
  }
  const join = findBailoutJoin(input.main, input.geometry);
  if (!join) {
    return { error: "This GPX does not meet the prepared route. Klandagi will not invent a connector." };
  }
  return {
    route: {
      id: bailoutId(name, input.geometry),
      routeId: input.routeId,
      name,
      geometry: input.geometry,
      join,
      lengthMeters,
      disclaimer: BAILOUT_ROUTE_DISCLAIMER,
    },
  };
}

export function parseBailoutGpx(input: {
  routeId: string;
  name: string;
  gpx: string;
  main: GeoJSON.LineString | GeoJSON.MultiLineString;
}): { route: PreparedBailoutRoute } | { error: string } {
  const geometry = parseGpx(input.gpx);
  if (!geometry) return { error: "That file is not a usable GPX track or route." };
  return prepareBailoutRoute({
    routeId: input.routeId,
    name: input.name.replace(/\.gpx$/i, "") || "Bailout track",
    geometry,
    main: input.main,
  });
}

export function attachBailoutRoute(
  routes: PreparedBailoutRoute[],
  next: PreparedBailoutRoute,
): { routes: PreparedBailoutRoute[] } | { error: string } {
  const without = routes.filter((route) => route.id !== next.id);
  const attached = [...without, next].slice(0, MAX_BAILOUT_ROUTES);
  if (without.length >= MAX_BAILOUT_ROUTES && !routes.some((route) => route.id === next.id)) {
    return { error: `At most ${MAX_BAILOUT_ROUTES} bailout tracks can be stored on one pack.` };
  }
  if (!validBailoutRoutes(attached, next.routeId)) {
    return { error: "Bailout tracks failed validation." };
  }
  return { routes: attached };
}

export function bailoutRouteCandidates(routes: PreparedBailoutRoute[] | null | undefined): BailoutCandidate[] {
  if (!routes?.length) return [];
  return routes.map((route) => ({
    id: route.id,
    name: route.name,
    kind: "custom" as const,
    lat: route.join.lat,
    lng: route.join.lng,
    routeDistanceMeters: route.join.alongMeters,
    exitDistanceMeters: route.join.offsetMeters,
    note: `${BAILOUT_ROUTE_DISCLAIMER} Follow the stored track from this join (${Math.round(route.lengthMeters)} m).`,
  }));
}

function validJoin(value: unknown): value is PreparedBailoutRoute["join"] {
  if (!value || typeof value !== "object") return false;
  const join = value as PreparedBailoutRoute["join"];
  return (
    Number.isFinite(join.lat) &&
    Number.isFinite(join.lng) &&
    Number.isFinite(join.alongMeters) &&
    Number.isFinite(join.offsetMeters) &&
    join.lat >= -90 &&
    join.lat <= 90 &&
    join.lng >= -180 &&
    join.lng <= 180 &&
    join.alongMeters >= 0 &&
    join.offsetMeters >= 0 &&
    join.offsetMeters <= BAILOUT_JOIN_METERS
  );
}

function validPreparedRoute(
  value: unknown,
  expectedRouteId: string,
  main?: GeoJSON.LineString | GeoJSON.MultiLineString,
): value is PreparedBailoutRoute {
  if (!value || typeof value !== "object") return false;
  const route = value as PreparedBailoutRoute;
  if (!validId(route.id) || !validId(route.routeId) || route.routeId !== expectedRouteId) return false;
  if (!validName(route.name) || route.disclaimer !== BAILOUT_ROUTE_DISCLAIMER) return false;
  if (!validGeometry(route.geometry)) return false;
  const length = lineLengthMeters(route.geometry);
  if (!Number.isFinite(length) || length <= 0 || length > 100_000) return false;
  if (!Number.isFinite(route.lengthMeters) || route.lengthMeters <= 0) return false;
  if (!validJoin(route.join)) return false;
  if (main) {
    const join = findBailoutJoin(main, route.geometry);
    if (!join) return false;
    if (Math.abs(join.alongMeters - route.join.alongMeters) > 25) return false;
    if (Math.abs(join.lat - route.join.lat) > 0.001 || Math.abs(join.lng - route.join.lng) > 0.001) return false;
  }
  return true;
}

export function validBailoutRoutes(
  value: unknown,
  expectedRouteId?: string,
  main?: GeoJSON.LineString | GeoJSON.MultiLineString,
): value is PreparedBailoutRoute[] {
  if (!Array.isArray(value) || value.length > MAX_BAILOUT_ROUTES) return false;
  if (expectedRouteId !== undefined && value.some((route) => !validPreparedRoute(route, expectedRouteId, main))) {
    return false;
  }
  if (expectedRouteId === undefined) {
    const first = value[0] as PreparedBailoutRoute | undefined;
    if (first && value.some((route) => !validPreparedRoute(route, first.routeId, main))) return false;
  }
  const ids = value.map((route) => (route as PreparedBailoutRoute).id);
  if (new Set(ids).size !== ids.length) return false;
  try {
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_BAILOUT_SET_BYTES) return false;
  } catch {
    return false;
  }
  return true;
}

export function describeBailoutRoutes(routes: PreparedBailoutRoute[]): string {
  if (!routes.length) return `No user-supplied bailout tracks stored. ${BAILOUT_ROUTE_DISCLAIMER}`;
  return `${routes.length} user-supplied bailout track${routes.length === 1 ? "" : "s"} stored. ${BAILOUT_ROUTE_DISCLAIMER}`;
}
