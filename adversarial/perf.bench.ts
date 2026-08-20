/**
 * Hostile-scale benchmark. Run:
 * node --expose-gc --max-old-space-size=4096 node_modules/tsx/dist/cli.mjs adversarial/perf.bench.ts
 */
import { performance } from "node:perf_hooks";
import { stat, writeFile } from "node:fs/promises";
import { cpus } from "node:os";
import { fileURLToPath } from "node:url";
import { progressAlongTrail } from "../src/lib/geo/navigation";
import { fetchElevationProfile, gpxFromLineString } from "../src/lib/geo";
import { buildRoutePack, MAX_ROUTE_PACK_COORDINATES } from "../src/lib/offline/route-pack";
import { createRouteProgressCache, progressWithRouteCache } from "../src/lib/offline/progress-cache";
import { relationToLineString } from "../src/lib/osm/overpass";

type Timing<T> = { value: T; ms: number; rssBeforeMB: number; rssAfterMB: number };
type GeometryRow = {
  coordinates: number;
  legacyProgressMs: number;
  cachedProgressFirstFixMs: number;
  cachedProgressSteadyFixMs: number;
  buildRoutePackMs: number;
  persistedGpxBytes: number;
  lengthMeters: number;
};

const ms = (value: number) => Math.round(value * 100) / 100;
const rssMB = () => ms(process.memoryUsage().rss / 1024 / 1024);
const makeLine = (count: number): GeoJSON.LineString => ({
  type: "LineString",
  coordinates: Array.from({ length: count }, (_, index) => [-119.5383 + index * 0.000001, 37.7749 + Math.sin(index / 200) * 0.00001]),
});
function measure<T>(fn: () => T): Timing<T> {
  if (global.gc) global.gc();
  const rssBeforeMB = rssMB();
  const started = performance.now();
  const value = fn();
  return { value, ms: ms(performance.now() - started), rssBeforeMB, rssAfterMB: rssMB() };
}
async function measureAsync<T>(fn: () => Promise<T>): Promise<Timing<T>> {
  if (global.gc) global.gc();
  const rssBeforeMB = rssMB();
  const started = performance.now();
  const value = await fn();
  return { value, ms: ms(performance.now() - started), rssBeforeMB, rssAfterMB: rssMB() };
}

async function main() {
  const result: {
    environment: { node: string; platform: string; cpus: number };
    geometries: GeometryRow[];
    oversizePack: { coordinates: number; rejected: boolean; message: string; ms: number };
    relation: { orderedMs: number; disconnectedMs: number; disconnectedLines: number };
    elevation: { samplesReturned: number; ms: number; postBytes: number };
    localStore: Array<{ preexistingPoints: number; appendLatencyMs: number; journalBytes: number }>;
    lazyGpx: { exportBytesAt100k: number; persistedBytesAt100k: number };
  } = {
    environment: { node: process.version, platform: process.platform, cpus: cpus().length },
    geometries: [], oversizePack: { coordinates: 0, rejected: false, message: "", ms: 0 },
    relation: { orderedMs: 0, disconnectedMs: 0, disconnectedLines: 0 },
    elevation: { samplesReturned: 0, ms: 0, postBytes: 0 }, localStore: [], lazyGpx: { exportBytesAt100k: 0, persistedBytesAt100k: 0 },
  };

  for (const coordinates of [1_000, 10_000, 100_000]) {
    const geometry = makeLine(coordinates);
    const legacy = measure(() => progressAlongTrail({ lat: 37.775, lng: -119.3 }, geometry));
    const packed = measure(() => buildRoutePack({ id: `plan-perf-${coordinates}`, name: `hostile-${coordinates}`, geometry }));
    const cache = createRouteProgressCache(packed.value);
    const firstCoordinate = geometry.coordinates[Math.floor(coordinates / 2)];
    const first = measure(() => progressWithRouteCache(cache, { lat: Number(firstCoordinate[1]), lng: Number(firstCoordinate[0]) }));
    const steady = measure(() => progressWithRouteCache(cache, { lat: Number(firstCoordinate[1]) + 0.00001, lng: Number(firstCoordinate[0]) + 0.00001 }));
    result.geometries.push({
      coordinates, legacyProgressMs: legacy.ms, cachedProgressFirstFixMs: first.ms, cachedProgressSteadyFixMs: steady.ms,
      buildRoutePackMs: packed.ms, persistedGpxBytes: Buffer.byteLength(packed.value.gpx ?? ""), lengthMeters: packed.value.lengthMeters,
    });
  }
  const exportGpx = measure(() => gpxFromLineString("export-only", makeLine(100_000)));
  result.lazyGpx = { exportBytesAt100k: Buffer.byteLength(exportGpx.value), persistedBytesAt100k: 0 };

  const rejected = measure(() => {
    try { buildRoutePack({ id: "plan-too-large", name: "too large", geometry: makeLine(500_000) }); return "accepted"; }
    catch (error) { return error instanceof Error ? error.message : String(error); }
  });
  result.oversizePack = { coordinates: 500_000, rejected: rejected.value !== "accepted", message: rejected.value, ms: rejected.ms };

  const ways = Array.from({ length: 5_000 }, (_, id) => ({ type: "way" as const, id, geometry: [{ lon: -120 + id * 0.00001, lat: 38 }, { lon: -120 + (id + 1) * 0.00001, lat: 38 }] }));
  const disconnectedWays = Array.from({ length: 5_000 }, (_, id) => ({ type: "way" as const, id, geometry: [{ lon: -120 + id * 0.01, lat: 38 }, { lon: -120 + id * 0.01 + 0.00001, lat: 38 }] }));
  const ordered = measure(() => relationToLineString(ways));
  const disconnected = measure(() => relationToLineString(disconnectedWays));
  result.relation = { orderedMs: ordered.ms, disconnectedMs: disconnected.ms, disconnectedLines: disconnected.value?.type === "MultiLineString" ? disconnected.value.coordinates.length : 0 };

  let postBytes = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    postBytes = typeof init?.body === "string" ? Buffer.byteLength(init.body) : 0;
    return new Response(JSON.stringify({ results: Array.from({ length: 51 }, () => ({ elevation: 123 })) }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const elevation = await measureAsync(() => fetchElevationProfile(makeLine(100_000)));
  globalThis.fetch = previousFetch;
  result.elevation = { samplesReturned: elevation.value.length, ms: elevation.ms, postBytes };

  process.env.LOCAL_STORE_PATH = fileURLToPath(new URL("./local-store-50k.json", import.meta.url));
  const { addActivityPoint } = await import("../src/lib/store/local");
  for (const count of [0, 1_000, 10_000, 50_000]) {
    const points = Array.from({ length: count }, (_, index) => ({ id: `seed-${index}`, activityId: "hostile-activity", lat: 37 + index / 1e7, lng: -119, elevation: null, recordedAt: new Date(1_700_000_000_000 + index * 1000).toISOString() }));
    await writeFile(process.env.LOCAL_STORE_PATH, JSON.stringify({ plans: [], activities: [], points }));
    await writeFile(`${process.env.LOCAL_STORE_PATH}.points.ndjson`, "");
    const started = performance.now();
    await addActivityPoint({ activityId: "hostile-activity", lat: 42, lng: -100, elevation: null, recordedAt: new Date().toISOString() });
    const journalBytes = (await stat(`${process.env.LOCAL_STORE_PATH}.points.ndjson`)).size;
    result.localStore.push({ preexistingPoints: count, appendLatencyMs: ms(performance.now() - started), journalBytes });
  }

  // Resolved relative to this file: the previous hardcoded absolute path
  // only existed on one machine and would fail in CI.
  await writeFile(new URL("./perf-results.json", import.meta.url), JSON.stringify(result, null, 2));
  console.log(`MAX_ROUTE_PACK_COORDINATES=${MAX_ROUTE_PACK_COORDINATES}`);
  console.log(`BENCH_JSON=${JSON.stringify(result, null, 2)}`);
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
