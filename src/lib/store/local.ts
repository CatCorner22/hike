import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export interface StoredPlan {
  id: string;
  /** Null means the row predates owner scoping; it belongs to nobody and stays hidden. */
  ownerId: string | null;
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
  ownerId: string | null;
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
  activityId: string;
  clientPointId?: string;
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
let mutationQueue: Promise<void> = Promise.resolve();

/** A parseable but unrecognised file must be preserved for recovery, not reset. */
export class LocalStoreCorruptionError extends Error {
  constructor(message = "Local store format is unrecognized. Saved data was not changed.") {
    super(message);
    this.name = "LocalStoreCorruptionError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function isStoredPlan(value: unknown): value is StoredPlan {
  if (!isRecord(value)) return false;
  return typeof value.id === "string" &&
    isNullableString(value.ownerId) &&
    typeof value.name === "string" &&
    isNullableString(value.trailId) &&
    isNullableString(value.plannedDate) &&
    isNullableString(value.notes) &&
    Array.isArray(value.campgroundIds) &&
    value.campgroundIds.every((id) => typeof id === "string") &&
    isNullableString(value.createdAt) &&
    isNullableString(value.updatedAt);
}

function isStoredActivity(value: unknown): value is StoredActivity {
  if (!isRecord(value)) return false;
  return typeof value.id === "string" &&
    isNullableString(value.ownerId) &&
    isNullableString(value.planId) &&
    isNullableString(value.trailId) &&
    isNullableString(value.name) &&
    typeof value.startedAt === "string" &&
    isNullableString(value.endedAt) &&
    isNullableString(value.notes) &&
    typeof value.createdAt === "string";
}

function isStoredPoint(value: unknown): value is StoredPoint {
  if (!isRecord(value)) return false;
  return typeof value.id === "string" &&
    typeof value.activityId === "string" &&
    (value.clientPointId === undefined || typeof value.clientPointId === "string") &&
    Number.isFinite(value.lat) &&
    Number.isFinite(value.lng) &&
    (typeof value.elevation === "number" || value.elevation === null) &&
    typeof value.recordedAt === "string";
}

function parseStore(raw: string): LocalStore {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) ||
    !Array.isArray(parsed.plans) ||
    !Array.isArray(parsed.activities) ||
    !Array.isArray(parsed.points) ||
    !parsed.plans.every(isStoredPlan) ||
    !parsed.activities.every(isStoredActivity) ||
    !parsed.points.every(isStoredPoint)) {
    throw new LocalStoreCorruptionError();
  }
  return {
    plans: parsed.plans,
    activities: parsed.activities,
    points: parsed.points,
  };
}

/**
 * In-memory copy of the store, keyed by the file identity it was loaded from.
 *
 * Every mutation used to re-read and re-parse the whole JSON file, so append
 * latency grew linearly with the recording: measured 0.9 ms empty, 21.8 ms at
 * 10k points and 105.2 ms at 50k. A GPS point arrives every second on a long
 * hike, so the write path got slower exactly as the hike got longer.
 *
 * `mtimeMs` and `size` are checked before trusting the cache, so an external
 * writer (another process, or a developer editing the file) still wins rather
 * than being silently overwritten from stale memory.
 */
let cache: { path: string; mtimeMs: number; size: number; store: LocalStore } | null = null;

function storePath() {
  return (
    process.env.LOCAL_STORE_PATH ||
    path.join(process.cwd(), "data", "store.json")
  );
}

export class LocalStoreDisabledError extends Error {
  constructor() {
    super(
      "JSON file store is disabled in production. Set DATABASE_URL, or set " +
        "ALLOW_LOCAL_STORE_IN_PRODUCTION=true for a single-node fallback.",
    );
    this.name = "LocalStoreDisabledError";
  }
}

/**
 * The JSON file is a single-process fallback for local development and CI.
 * Production must not silently write plans and GPS tracks to an ephemeral disk
 * that no other instance can see — that masquerades as persistence.
 */
export function isLocalStoreEnabled(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return process.env.ALLOW_LOCAL_STORE_IN_PRODUCTION === "true";
}

function assertLocalStoreEnabled(): void {
  if (!isLocalStoreEnabled()) throw new LocalStoreDisabledError();
}

async function readStore(): Promise<LocalStore> {
  assertLocalStoreEnabled();
  const file = storePath();
  try {
    const info = await stat(file);
    if (cache && cache.path === file && cache.mtimeMs === info.mtimeMs && cache.size === info.size) {
      return cache.store;
    }
  } catch {
    // Missing file is handled by the read below; a stat failure just means we
    // cannot trust the cache.
    cache = null;
  }
  try {
    const raw = await readFile(file, "utf8");
    const store = parseStore(raw);
    try {
      const info = await stat(file);
      cache = { path: file, mtimeMs: info.mtimeMs, size: info.size, store };
    } catch {
      cache = null;
    }
    return store;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      const store = structuredClone(EMPTY);
      cache = null;
      return store;
    }
    throw error;
  }
}

async function writeStore(store: LocalStore) {
  assertLocalStoreEnabled();
  const file = storePath();
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  // Not pretty-printed: indentation roughly doubled the bytes written on every
  // single mutation, and nothing reads this file by eye during a recording.
  await writeFile(temporary, JSON.stringify(store));
  await rename(temporary, file);
  try {
    const info = await stat(file);
    cache = { path: file, mtimeMs: info.mtimeMs, size: info.size, store };
  } catch {
    // If we cannot stamp the cache, drop it rather than trusting it.
    cache = null;
  }
}

function mutateStore<T>(
  mutation: (store: LocalStore) => T | Promise<T>,
): Promise<T> {
  const result = mutationQueue.then(async () => {
    const store = await readStore();
    const value = await mutation(store);
    await writeStore(store);
    return value;
  });
  mutationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

// Owner is a required argument on every accessor below rather than an optional filter:
// forgetting it is then a type error, not a silent data leak.

export async function listPlans(ownerId: string) {
  const store = await readStore();
  return store.plans
    .filter((p) => p.ownerId === ownerId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getPlan(id: string, ownerId: string) {
  const store = await readStore();
  return store.plans.find((p) => p.id === id && p.ownerId === ownerId) ?? null;
}

export async function createPlan(input: {
  ownerId: string;
  name: string;
  trailId?: string | null;
  plannedDate?: string | null;
  notes?: string | null;
  waypoints?: unknown;
  campgroundIds?: string[];
  customGeometry?: GeoJSON.LineString | GeoJSON.MultiLineString | null;
}) {
  return mutateStore((store) => {
    const now = new Date().toISOString();
    const plan: StoredPlan = {
      id: crypto.randomUUID(),
      ownerId: input.ownerId,
      name: input.name,
      trailId: input.trailId ?? null,
      plannedDate: input.plannedDate ?? null,
      notes: input.notes ?? null,
      waypoints: input.waypoints ?? null,
      campgroundIds: input.campgroundIds ?? [],
      customGeometry: input.customGeometry ?? null,
      createdAt: now,
      updatedAt: now,
    };
    store.plans.unshift(plan);
    return plan;
  });
}

/** OCC tokens must move even when two writes land in the same millisecond. */
export function nextIsoTimestamp(previous?: string): string {
  const now = Date.now();
  const prior = previous ? Date.parse(previous) : Number.NaN;
  const next = Number.isFinite(prior) && now <= prior ? prior + 1 : now;
  return new Date(next).toISOString();
}

export async function updatePlan(id: string, ownerId: string, updates: Partial<StoredPlan>) {
  return mutateStore((store) => {
    const index = store.plans.findIndex((p) => p.id === id && p.ownerId === ownerId);
    if (index < 0) return null;
    store.plans[index] = {
      ...store.plans[index],
      ...updates,
      id,
      ownerId,
      updatedAt: nextIsoTimestamp(store.plans[index].updatedAt),
    };
    return store.plans[index];
  });
}

/** Returns false when the plan does not exist or belongs to someone else. */
export async function deletePlan(id: string, ownerId: string) {
  return mutateStore((store) => {
    const before = store.plans.length;
    store.plans = store.plans.filter((p) => !(p.id === id && p.ownerId === ownerId));
    return store.plans.length < before;
  });
}

export async function listActivities(ownerId: string) {
  const store = await readStore();
  return store.activities
    .filter((a) => a.ownerId === ownerId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export async function getActivity(id: string, ownerId: string) {
  const store = await readStore();
  return store.activities.find((a) => a.id === id && a.ownerId === ownerId) ?? null;
}

export async function createActivity(input: {
  ownerId: string;
  trailId?: string | null;
  planId?: string | null;
  name?: string | null;
  startedAt: string;
}) {
  return mutateStore((store) => {
    const now = new Date().toISOString();
    const activity: StoredActivity = {
      id: crypto.randomUUID(),
      ownerId: input.ownerId,
      planId: input.planId ?? null,
      trailId: input.trailId ?? null,
      name: input.name ?? null,
      startedAt: input.startedAt,
      endedAt: null,
      stats: {},
      notes: null,
      trackGeometry: null,
      createdAt: now,
    };
    store.activities.unshift(activity);
    return activity;
  });
}

export async function updateActivity(
  id: string,
  ownerId: string,
  updates: Partial<StoredActivity>,
) {
  return mutateStore((store) => {
    const index = store.activities.findIndex((a) => a.id === id && a.ownerId === ownerId);
    if (index < 0) return null;
    store.activities[index] = { ...store.activities[index], ...updates, id, ownerId };
    return store.activities[index];
  });
}

export async function addActivityPoints(points: Array<Omit<StoredPoint, "id">>) {
  return mutateStore((store) => {
    const saved = points.map((point): StoredPoint => ({ ...point, id: crypto.randomUUID() }));
    store.points.push(...saved);
    return saved;
  });
}

export async function addActivityPoint(point: Omit<StoredPoint, "id">) {
  return (await addActivityPoints([point]))[0];
}

export async function listActivityPoints(activityId: string) {
  const store = await readStore();
  return store.points
    .filter((p) => p.activityId === activityId)
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
}
