import {
  buildRoutePack,
  getRoutePack,
  packCandidateIds,
  saveRoutePack,
  type RoutePack,
} from "@/lib/offline/route-pack";
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
      const pack = await getRoutePack(id);
      if (pack) return pack;
    }
    if (attempt < retries) await sleep(retryMs);
  }

  return null;
}

export async function persistRoutePack(pack: RoutePack): Promise<RoutePack> {
  if (!isValidGeometry(pack.geometry)) {
    throw new Error("Route geometry is invalid — cannot navigate safely");
  }
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
    aliases: [plan.id, plan.trailId, plan.trailId ? `trail-${plan.trailId}` : navId].filter(
      Boolean,
    ) as string[],
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
  return !navigator.onLine;
}
