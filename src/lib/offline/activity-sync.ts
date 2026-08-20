import { getOfflineDb, queueActivityPoint } from "@/lib/offline";

export interface LocalActivity {
  id: string;
  remoteId?: string;
  trailId?: string;
  planId?: string;
  name?: string;
  startedAt: string;
  endedAt?: string;
  stats?: {
    distanceMeters: number;
    elevationGainMeters: number;
    durationSeconds: number;
  };
  pendingStop: boolean;
}

export interface QueuedPoint {
  activityId?: string;
  lat: number;
  lng: number;
  elevation?: number;
  recordedAt: Date | string;
}

async function putLocalActivity(row: LocalActivity) {
  const db = await getOfflineDb();
  if (!db || !db.objectStoreNames.contains("localActivities")) return;
  await db.put("localActivities", row);
}

export async function getLocalActivity(id: string): Promise<LocalActivity | null> {
  const db = await getOfflineDb();
  if (!db || !db.objectStoreNames.contains("localActivities")) return null;
  return (await db.get("localActivities", id)) ?? null;
}

export async function listLocalActivities(): Promise<LocalActivity[]> {
  const db = await getOfflineDb();
  if (!db || !db.objectStoreNames.contains("localActivities")) return [];
  return db.getAll("localActivities");
}

/** Start an activity even with no network. Syncs when a POST succeeds. */
export async function beginActivity(input: {
  trailId?: string;
  planId?: string;
  name?: string;
}): Promise<{ id: string; offline: boolean }> {
  const startedAt = new Date().toISOString();
  const localId = crypto.randomUUID();
  const local: LocalActivity = {
    id: localId,
    trailId: input.trailId,
    planId: input.planId,
    name: input.name,
    startedAt,
    pendingStop: false,
  };

  try {
    const res = await fetch("/api/activities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        trailId: input.trailId,
        planId: input.planId,
        name: input.name,
        startedAt,
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as { id?: string };
      if (data.id) {
        local.remoteId = data.id;
        await putLocalActivity(local);
        return { id: data.id, offline: false };
      }
    }
  } catch {
    /* offline */
  }

  await putLocalActivity(local);
  return { id: localId, offline: true };
}

export async function saveActivityPoint(activityId: string, point: QueuedPoint): Promise<boolean> {
  const payload = {
    lat: point.lat,
    lng: point.lng,
    elevation: point.elevation,
    recordedAt:
      typeof point.recordedAt === "string"
        ? point.recordedAt
        : point.recordedAt.toISOString(),
  };
  try {
    const res = await fetch(`/api/activities/${activityId}/points`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) return true;
  } catch {
    /* queue */
  }
  await queueActivityPoint({
    activityId,
    lat: point.lat,
    lng: point.lng,
    elevation: point.elevation,
    recordedAt: new Date(payload.recordedAt),
  });
  return false;
}

async function ensureRemoteId(local: LocalActivity): Promise<string | null> {
  if (local.remoteId) return local.remoteId;
  try {
    const res = await fetch("/api/activities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        trailId: local.trailId,
        planId: local.planId,
        name: local.name,
        startedAt: local.startedAt,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { id?: string };
    if (!data.id) return null;
    local.remoteId = data.id;
    await putLocalActivity(local);
    return data.id;
  } catch {
    return null;
  }
}

export async function flushPendingPoints(activityId: string): Promise<number> {
  const db = await getOfflineDb();
  if (!db) return 0;
  const rows = await db.getAllFromIndex("pendingPoints", "by-activity", activityId);
  const pending = rows.filter((p) => !p.synced);
  let flushed = 0;
  for (const point of pending) {
    try {
      const res = await fetch(`/api/activities/${activityId}/points`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat: point.lat,
          lng: point.lng,
          elevation: point.elevation,
          recordedAt: point.recordedAt,
        }),
      });
      if (!res.ok) continue;
      await db.put("pendingPoints", { ...point, synced: 1 });
      flushed += 1;
    } catch {
      break;
    }
  }
  return flushed;
}

export async function finishActivity(
  activityId: string,
  stats: LocalActivity["stats"],
): Promise<{ synced: boolean }> {
  const endedAt = new Date().toISOString();
  const local = (await getLocalActivity(activityId)) ?? {
    id: activityId,
    startedAt: endedAt,
    pendingStop: true,
    stats,
    endedAt,
  };
  local.stats = stats;
  local.endedAt = endedAt;
  local.pendingStop = true;
  await putLocalActivity(local);

  await flushPendingPoints(local.remoteId ?? activityId);

  const id = local.remoteId ?? activityId;
  try {
    const res = await fetch(`/api/activities/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endedAt, stats }),
    });
    if (res.ok) {
      local.pendingStop = false;
      await putLocalActivity(local);
      return { synced: true };
    }
  } catch {
    /* stay queued */
  }
  return { synced: false };
}

/** Replay queued points and pending stops when the radio comes back. */
export async function flushActivityQueue(): Promise<void> {
  const locals = await listLocalActivities();
  for (const local of locals) {
    const remote = await ensureRemoteId(local);
    const pointId = remote ?? local.id;
    if (remote && remote !== local.id) {
      const db = await getOfflineDb();
      if (db) {
        const queued = await db.getAllFromIndex("pendingPoints", "by-activity", local.id);
        for (const point of queued) {
          if (point.synced) continue;
          await db.put("pendingPoints", { ...point, activityId: remote });
        }
      }
    }
    await flushPendingPoints(pointId);
    if (local.pendingStop && local.endedAt) {
      try {
        const res = await fetch(`/api/activities/${pointId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endedAt: local.endedAt, stats: local.stats }),
        });
        if (res.ok) {
          local.pendingStop = false;
          await putLocalActivity(local);
        }
      } catch {
        /* still offline */
      }
    }
  }
}
