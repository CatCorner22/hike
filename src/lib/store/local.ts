import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface StoredPlan {
  id: string;
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
  } catch {
    return structuredClone(EMPTY);
  }
}

async function writeStore(store: LocalStore) {
  const file = storePath();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(store, null, 2));
}

export async function listPlans() {
  const store = await readStore();
  return store.plans.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getPlan(id: string) {
  const store = await readStore();
  return store.plans.find((p) => p.id === id) ?? null;
}

export async function createPlan(input: {
  name: string;
  trailId?: string | null;
  plannedDate?: string | null;
  notes?: string | null;
  waypoints?: unknown;
  campgroundIds?: string[];
  customGeometry?: GeoJSON.LineString | GeoJSON.MultiLineString | null;
}) {
  const store = await readStore();
  const now = new Date().toISOString();
  const plan: StoredPlan = {
    id: crypto.randomUUID(),
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
  await writeStore(store);
  return plan;
}

export async function updatePlan(id: string, updates: Partial<StoredPlan>) {
  const store = await readStore();
  const index = store.plans.findIndex((p) => p.id === id);
  if (index < 0) return null;
  store.plans[index] = {
    ...store.plans[index],
    ...updates,
    id,
    updatedAt: new Date().toISOString(),
  };
  await writeStore(store);
  return store.plans[index];
}

export async function deletePlan(id: string) {
  const store = await readStore();
  store.plans = store.plans.filter((p) => p.id !== id);
  await writeStore(store);
}

export async function listActivities() {
  const store = await readStore();
  return store.activities.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export async function getActivity(id: string) {
  const store = await readStore();
  return store.activities.find((a) => a.id === id) ?? null;
}

export async function createActivity(input: {
  trailId?: string | null;
  planId?: string | null;
  name?: string | null;
  startedAt: string;
}) {
  const store = await readStore();
  const now = new Date().toISOString();
  const activity: StoredActivity = {
    id: crypto.randomUUID(),
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
  await writeStore(store);
  return activity;
}

export async function updateActivity(id: string, updates: Partial<StoredActivity>) {
  const store = await readStore();
  const index = store.activities.findIndex((a) => a.id === id);
  if (index < 0) return null;
  store.activities[index] = { ...store.activities[index], ...updates, id };
  await writeStore(store);
  return store.activities[index];
}

export async function addActivityPoint(point: Omit<StoredPoint, "id">) {
  const store = await readStore();
  const saved: StoredPoint = { ...point, id: crypto.randomUUID() };
  store.points.push(saved);
  await writeStore(store);
  return saved;
}

export async function listActivityPoints(activityId: string) {
  const store = await readStore();
  return store.points
    .filter((p) => p.activityId === activityId)
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
}
