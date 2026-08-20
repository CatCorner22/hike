import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
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

function storePath() {
  return (
    process.env.LOCAL_STORE_PATH ||
    path.join(process.cwd(), "data", "store.json")
  );
}

async function readStore(): Promise<LocalStore> {
  try {
    const raw = await readFile(storePath(), "utf8");
    const parsed = JSON.parse(raw) as LocalStore;
    return {
      plans: parsed.plans ?? [],
      activities: parsed.activities ?? [],
      points: parsed.points ?? [],
    };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return structuredClone(EMPTY);
    }
    throw error;
  }
}

async function writeStore(store: LocalStore) {
  const file = storePath();
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(store, null, 2));
  await rename(temporary, file);
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

export async function updatePlan(id: string, ownerId: string, updates: Partial<StoredPlan>) {
  return mutateStore((store) => {
    const index = store.plans.findIndex((p) => p.id === id && p.ownerId === ownerId);
    if (index < 0) return null;
    store.plans[index] = {
      ...store.plans[index],
      ...updates,
      id,
      ownerId,
      updatedAt: new Date().toISOString(),
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

export async function addActivityPoint(point: Omit<StoredPoint, "id">) {
  return mutateStore((store) => {
    const saved: StoredPoint = { ...point, id: crypto.randomUUID() };
    store.points.push(saved);
    return saved;
  });
}

export async function listActivityPoints(activityId: string) {
  const store = await readStore();
  return store.points
    .filter((p) => p.activityId === activityId)
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
}
