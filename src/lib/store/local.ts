import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export interface StoredPlan {
  id: string;
  ownerId: string;
  name: string;
  trailId: string | null;
  plannedDate: string | null;
  notes: string | null;
  waypoints: unknown;
  campgroundIds: string[];
  customGeometry: GeoJSON.LineString | GeoJSON.MultiLineString | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoredActivity {
  id: string;
  ownerId: string;
  planId: string | null;
  trailId: string | null;
  name: string | null;
  startedAt: string;
  endedAt: string | null;
  stats: Record<string, number> | null;
  notes: string | null;
  trackGeometry: GeoJSON.LineString | null;
  createdAt: string;
}

export interface StoredPoint {
  id: string;
  ownerId: string;
  activityId: string;
  lat: number;
  lng: number;
  elevation: number | null;
  recordedAt: string;
}

interface LocalStore {
  plans: StoredPlan[];
  activities: StoredActivity[];
  points: StoredPoint[];
}

const EMPTY: LocalStore = { plans: [], activities: [], points: [] };
const LEGACY_OWNER_ID = "legacy";
let mutationQueue: Promise<void> = Promise.resolve();

if (!process.env.DATABASE_URL) {
  // The fallback is intentionally conspicuous: it is not a database and is not
  // safe across multiple processes or hosts.
  console.warn("[SECURITY WARNING] JSON local-store fallback is active. Use Postgres in production; set ALLOW_LOCAL_STORE_IN_PRODUCTION=true only for an explicitly accepted single-process emergency deployment.");
}

function assertLocalStoreAllowed() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_LOCAL_STORE_IN_PRODUCTION !== "true") {
    throw new Error("Refusing JSON fallback in production. Configure DATABASE_URL or explicitly set ALLOW_LOCAL_STORE_IN_PRODUCTION=true for a single-process emergency deployment.");
  }
}

function storePath() {
  return process.env.LOCAL_STORE_PATH || path.join(process.cwd(), "data", "store.json");
}

function pointJournalPath() {
  return `${storePath()}.points.ndjson`;
}

async function readJournalPoints(): Promise<StoredPoint[]> {
  try {
    const raw = await readFile(pointJournalPath(), "utf8");
    return raw.split("\n").filter(Boolean).flatMap((line) => {
      try {
        const point = JSON.parse(line) as StoredPoint;
        return point && typeof point.id === "string" ? [point] : [];
      } catch { return []; }
    });
  } catch { return []; }
}

async function readStore(): Promise<LocalStore> {
  assertLocalStoreAllowed();
  try {
    const raw = await readFile(storePath(), "utf8");
    const parsed = JSON.parse(raw) as LocalStore;
    return {
      // Old fallback rows are deliberately inaccessible: map them to a
      // sentinel no live signed device cookie can receive.
      plans: (parsed.plans ?? []).map((plan) => ({ ...plan, ownerId: plan.ownerId ?? LEGACY_OWNER_ID })),
      activities: (parsed.activities ?? []).map((activity) => ({ ...activity, ownerId: activity.ownerId ?? LEGACY_OWNER_ID })),
      // Points appended after the last compaction are replayed in order. A
      // torn final journal line is ignored rather than corrupting all history.
      points: [...(parsed.points ?? []), ...(await readJournalPoints())].map((point) => ({ ...point, ownerId: point.ownerId ?? LEGACY_OWNER_ID })),
    };
  } catch {
    return { ...structuredClone(EMPTY), points: await readJournalPoints() };
  }
}

async function writeStore(store: LocalStore) {
  const file = storePath();
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(store, null, 2));
  await rename(temporary, file);
  // Full writes are rare metadata operations. They compact the append journal
  // after the new base file is durable, preserving activity points on failure.
  await rm(pointJournalPath(), { force: true });
}

async function mutateStore<T>(operation: (store: LocalStore) => Promise<T> | T): Promise<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const result = new Promise<T>((resolveResult, rejectResult) => {
    resolve = resolveResult;
    reject = rejectResult;
  });
  mutationQueue = mutationQueue.then(async () => {
    try {
      const value = await operation(await readStore());
      resolve(value);
    } catch (error) {
      reject(error);
    }
  }, async () => {
    try {
      const value = await operation(await readStore());
      resolve(value);
    } catch (error) {
      reject(error);
    }
  });
  return result;
}

export async function listPlans(ownerId: string) {
  const store = await readStore();
  return store.plans.filter((plan) => plan.ownerId === ownerId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getPlan(id: string, ownerId: string) {
  const store = await readStore();
  return store.plans.find((plan) => plan.id === id && plan.ownerId === ownerId) ?? null;
}

export async function createPlan(input: {
  name: string;
  ownerId: string;
  trailId?: string | null;
  plannedDate?: string | null;
  notes?: string | null;
  waypoints?: unknown;
  campgroundIds?: string[];
  customGeometry?: GeoJSON.LineString | GeoJSON.MultiLineString | null;
}) {
  return mutateStore(async (store) => {
    const now = new Date().toISOString();
    const plan: StoredPlan = {
      id: crypto.randomUUID(), ownerId: input.ownerId, name: input.name,
      trailId: input.trailId ?? null, plannedDate: input.plannedDate ?? null,
      notes: input.notes ?? null, waypoints: input.waypoints ?? null,
      campgroundIds: input.campgroundIds ?? [], customGeometry: input.customGeometry ?? null,
      createdAt: now, updatedAt: now,
    };
    store.plans.unshift(plan);
    await writeStore(store);
    return plan;
  });
}

export async function updatePlan(id: string, ownerId: string, updates: Partial<StoredPlan>) {
  return mutateStore(async (store) => {
    const index = store.plans.findIndex((plan) => plan.id === id && plan.ownerId === ownerId);
    if (index < 0) return null;
    store.plans[index] = { ...store.plans[index], ...updates, id, ownerId, updatedAt: new Date().toISOString() };
    await writeStore(store);
    return store.plans[index];
  });
}

export async function deletePlan(id: string, ownerId: string) {
  return mutateStore(async (store) => {
    const existing = store.plans.some((plan) => plan.id === id && plan.ownerId === ownerId);
    if (!existing) return false;
    store.plans = store.plans.filter((plan) => plan.id !== id);
    await writeStore(store);
    return true;
  });
}

export async function listActivities(ownerId: string) {
  const store = await readStore();
  return store.activities.filter((activity) => activity.ownerId === ownerId).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export async function getActivity(id: string, ownerId: string) {
  const store = await readStore();
  return store.activities.find((activity) => activity.id === id && activity.ownerId === ownerId) ?? null;
}

export async function createActivity(input: {
  trailId?: string | null;
  planId?: string | null;
  name?: string | null;
  startedAt: string;
  ownerId: string;
}) {
  return mutateStore(async (store) => {
    const now = new Date().toISOString();
    const activity: StoredActivity = {
      id: crypto.randomUUID(), ownerId: input.ownerId, planId: input.planId ?? null,
      trailId: input.trailId ?? null, name: input.name ?? null, startedAt: input.startedAt,
      endedAt: null, stats: {}, notes: null, trackGeometry: null, createdAt: now,
    };
    store.activities.unshift(activity);
    await writeStore(store);
    return activity;
  });
}

export async function updateActivity(id: string, ownerId: string, updates: Partial<StoredActivity>) {
  return mutateStore(async (store) => {
    const index = store.activities.findIndex((activity) => activity.id === id && activity.ownerId === ownerId);
    if (index < 0) return null;
    store.activities[index] = { ...store.activities[index], ...updates, id, ownerId };
    await writeStore(store);
    return store.activities[index];
  });
}

export async function addActivityPoint(point: Omit<StoredPoint, "id" | "ownerId"> & { ownerId?: string }) {
  return mutateStore(async () => {
    const saved: StoredPoint = { ...point, ownerId: point.ownerId ?? LEGACY_OWNER_ID, id: crypto.randomUUID() };
    const journal = pointJournalPath();
    await mkdir(path.dirname(journal), { recursive: true });
    // Recording never rewrites historical points. Newline-delimited records are
    // append-only and survive a process interruption without losing the prior log.
    await appendFile(journal, `${JSON.stringify(saved)}\n`, "utf8");
    return saved;
  });
}

export async function listActivityPoints(activityId: string, ownerId: string) {
  const store = await readStore();
  return store.points
    .filter((point) => point.activityId === activityId && point.ownerId === ownerId)
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id));
}
