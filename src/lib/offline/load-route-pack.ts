import { isOnline } from "@/lib/platform/network";
import {
  buildRoutePack,
  getRoutePackStatus,
  packCandidateIds,
  saveRoutePack,
  validPackWeather,
  type RoutePack,
} from "@/lib/offline/route-pack";
import { validCorridorFeatures } from "@/lib/offline/corridor-features";
import { validHazardBrief } from "@/lib/offline/hazard-brief";
import { validOfficialAlertSnapshot } from "@/lib/offline/official-alerts";
import { validBailoutRoutes } from "@/lib/offline/bailout-routes";
import { validTerrainCorridor } from "@/lib/offline/terrain-corridor";
import { isValidGeometry } from "@/lib/geo/navigation";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function loadCachedRoutePack(
  navId: string,
  options: { retries?: number; retryMs?: number } = {},
): Promise<RoutePack | null> {
  const retries = options.retries ?? 0;
  const retryMs = options.retryMs ?? 150;

  for (let attempt = 0; attempt <= retries; attempt++) {
    for (const id of packCandidateIds(navId)) {
      const lookup = await getRoutePackStatus(id);
      if (lookup.status === "invalid") {
        throw new Error(lookup.error ?? "Saved route pack is corrupt — re-download while you have signal.");
      }
      if (lookup.status === "ready" && lookup.pack) return lookup.pack;
    }
    if (attempt < retries) await sleep(retryMs);
  }

  return null;
}

/** Keep Prepare extras when a plan/trail page rebuilds a pack from the server. */
export function enrichRoutePack(base: RoutePack, existing?: RoutePack | null): RoutePack {
  if (!existing) return base;
  const corridor = existing.corridor && validTerrainCorridor(existing.corridor, base.id, base.geometry)
    ? existing.corridor
    : undefined;
  const keepWeather = (weather: RoutePack["weather"]) =>
    weather && validPackWeather(weather) ? weather : undefined;
  const keepFeatures = (features: RoutePack["corridorFeatures"]) =>
    corridor && features && validCorridorFeatures(features, base.id, corridor.bboxes) ? features : undefined;
  const keepBrief = (brief: RoutePack["hazardBrief"]) =>
    brief && validHazardBrief(brief, base.id, base.bbox) ? brief : undefined;
  const keepOfficialAlerts = (snapshot: RoutePack["officialAlerts"]) =>
    snapshot && validOfficialAlertSnapshot(snapshot, base.id) ? snapshot : undefined;
  const keepBailouts = (routes: RoutePack["bailoutRoutes"]) =>
    routes && validBailoutRoutes(routes, base.id, base.geometry) ? routes : undefined;
  return buildRoutePack({
    id: base.id,
    aliases: base.aliases,
    name: base.name,
    geometry: base.geometry,
    bbox: base.bbox,
    elevationProfile: base.elevationProfile,
    weather: keepWeather(base.weather) ?? keepWeather(existing.weather),
    corridor: corridor ?? base.corridor,
    corridorFeatures: keepFeatures(base.corridorFeatures) ?? keepFeatures(existing.corridorFeatures),
    hazardBrief: keepBrief(base.hazardBrief) ?? keepBrief(existing.hazardBrief),
    officialAlerts: keepOfficialAlerts(base.officialAlerts) ?? keepOfficialAlerts(existing.officialAlerts),
    bailoutRoutes: keepBailouts(base.bailoutRoutes) ?? keepBailouts(existing.bailoutRoutes),
  });
}

export async function persistRoutePack(pack: RoutePack): Promise<RoutePack> {
  await saveRoutePack(pack);
  const verified = await loadCachedRoutePack(pack.id, { retries: 5, retryMs: 100 });
  if (!verified) throw new Error("Route pack failed to save on device");
  return verified;
}

export function packFromTrailApi(
  navId: string,
  data: {
    id: string;
    name: string;
    geometry: GeoJSON.LineString | GeoJSON.MultiLineString;
    bbox?: [number, number, number, number];
    elevationProfile?: Array<{ distanceMeters: number; elevation: number }>;
  },
): RoutePack {
  if (!isValidGeometry(data.geometry)) {
    throw new Error("Trail geometry is missing or invalid");
  }
  const target = navId.startsWith("plan-") ? "plan" : "trail";
  const rawId = navId.replace(/^(trail|plan)-/, "");
  return buildRoutePack({
    id: navId,
    aliases:
      target === "trail"
        ? [`trail-${data.id}`, rawId, data.id]
        : [rawId, data.id, data.id ? `trail-${data.id}` : navId].filter(Boolean),
    name: data.name,
    geometry: data.geometry,
    bbox: data.bbox,
    elevationProfile: data.elevationProfile ?? [],
  });
}

export function packFromPlanApi(
  navId: string,
  plan: {
    id: string;
    name: string;
    trailId?: string | null;
    customGeometry?: GeoJSON.LineString | GeoJSON.MultiLineString | null;
  },
  trail?: {
    id?: string;
    name?: string;
    geometry?: GeoJSON.LineString | GeoJSON.MultiLineString;
    bbox?: [number, number, number, number];
    elevationProfile?: Array<{ distanceMeters: number; elevation: number }>;
  } | null,
): RoutePack | null {
  const geometry = trail?.geometry ?? plan.customGeometry;
  if (!geometry || !isValidGeometry(geometry)) return null;

  return buildRoutePack({
    id: navId,
    // A plan is its own safety route. Do not claim a shared trail alias here:
    // two plans for one trail can differ in direction or custom geometry.
    aliases: [plan.id],
    name: plan.name,
    geometry,
    bbox: trail?.bbox,
    elevationProfile: trail?.elevationProfile ?? [],
  });
}

export async function withNetworkTimeout<T>(
  factory: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await factory(controller.signal);
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error("Network timeout");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function isLikelyOffline(): boolean {
  if (typeof navigator === "undefined") return false;
  return !isOnline();
}
