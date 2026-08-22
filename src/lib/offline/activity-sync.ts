import { apiFetch } from "@/lib/api/client";
import {
  discardPendingPoints,
  getOfflineDb,
  markPointsSynced,
  notifyPendingPointsChanged,
  queueActivityPoint,
} from "@/lib/offline";

export interface LocalActivity {
  /** Stable, device-local session identity. Never replace this with the server ID. */
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
    pointCount?: number;
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

export type ActivityPointSaveResult = "synced" | "queued" | "rejected-finalized";

export interface FinishActivityResult {
  synced: boolean;
  remoteId?: string;
  rejectedPoints: number;
}

interface ActivityPointFlushResult {
  synced: number;
  pending: number;
  rejectedFinalized: number;
}

interface ServerOpenActivity {
  id: string;
  trailId?: string | null;
  planId?: string | null;
  name?: string | null;
  startedAt: string;
  endedAt?: string | null;
  stats?: LocalActivity["stats"] | null;
}

export type OpenActivityRecovery =
  | { status: "none" }
  | {
      status: "recovered";
      activity: LocalActivity;
      serverVerified: boolean;
      message: string;
    }
  | {
      status: "blocked";
      candidateCount: number;
      message: string;
    };

// The cache keeps a newly-started session usable when IndexedDB is unavailable for the
// current page. IndexedDB remains authoritative across reloads.
const localActivityCache = new Map<string, LocalActivity>();
const remoteIdPromises = new Map<string, Promise<string | null>>();
const pendingSnapshotWrites = new Set<Promise<string | null>>();
let activityQueueFlushPromise: Promise<void> | null = null;

function trackSnapshotWrite(write: Promise<string | null>): Promise<string | null> {
  pendingSnapshotWrites.add(write);
  void write.then(
    () => pendingSnapshotWrites.delete(write),
    () => pendingSnapshotWrites.delete(write),
  );
  return write;
}

async function waitForPendingSnapshotWrites(): Promise<void> {
  while (pendingSnapshotWrites.size > 0) {
    await Promise.allSettled([...pendingSnapshotWrites]);
  }
}

async function putLocalActivity(row: LocalActivity) {
  localActivityCache.set(row.id, row);
  const db = await getOfflineDb();
  if (!db || !db.objectStoreNames.contains("localActivities")) return;
  await db.put("localActivities", row);
}

export async function getLocalActivity(id: string): Promise<LocalActivity | null> {
  const cached = localActivityCache.get(id);
  if (cached) return cached;
  const db = await getOfflineDb();
  if (!db || !db.objectStoreNames.contains("localActivities")) return null;
  const row = (await db.get("localActivities", id)) ?? null;
  if (row) localActivityCache.set(row.id, row);
  return row;
}

export async function listLocalActivities(): Promise<LocalActivity[]> {
  const rows = new Map(localActivityCache);
  const db = await getOfflineDb();
  if (db?.objectStoreNames.contains("localActivities")) {
    for (const row of await db.getAll("localActivities")) {
      if (!rows.has(row.id)) rows.set(row.id, row);
    }
  }
  return [...rows.values()];
}

function matchesRecoveryContext(
  activity: Pick<LocalActivity, "trailId" | "planId"> | ServerOpenActivity,
  context: { trailId?: string; planId?: string },
): boolean {
  if (context.planId) return (activity.planId ?? null) === context.planId;
  if (context.trailId) return (activity.trailId ?? null) === context.trailId;
  return true;
}

function sameUnmappedActivity(local: LocalActivity, remote: ServerOpenActivity): boolean {
  return local.startedAt === remote.startedAt
    && (local.planId ?? null) === (remote.planId ?? null)
    && (local.trailId ?? null) === (remote.trailId ?? null)
    && (local.name ?? null) === (remote.name ?? null);
}

function validServerOpenActivity(value: unknown): value is ServerOpenActivity {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<ServerOpenActivity>;
  return typeof row.id === "string"
    && row.id.length > 0
    && typeof row.startedAt === "string"
    && Number.isFinite(Date.parse(row.startedAt))
    && (row.endedAt == null);
}

/**
 * Reconcile every unfinished local/server session after a document reload.
 * Exactly one candidate is adopted only when it belongs to the current route. A session
 * from another route, conflicting or multiple candidates, and a local session whose known
 * server row is closed all block Start instead of allowing overlapping or finalized tracks.
 */
export async function loadOpenActivityRecovery(context: {
  trailId?: string;
  planId?: string;
}): Promise<OpenActivityRecovery> {
  // A client-side route change unmounts the recorder without firing pagehide.
  // Its cleanup starts an IndexedDB snapshot write, so recovery must not read an
  // older row (often with no stats) until that durable write has settled.
  await waitForPendingSnapshotWrites();
  let localRows = await listLocalActivities();
  const pendingStops = localRows.filter((activity) =>
    Boolean(activity.endedAt)
    && activity.pendingStop,
  );

  if (pendingStops.length > 0) {
    const unresolved: LocalActivity[] = [];
    for (const pending of pendingStops) {
      const result = await finishActivity(pending.id, pending.stats);
      if (!result.synced) unresolved.push(pending);
    }
    if (unresolved.length > 0) {
      return {
        status: "blocked",
        candidateCount: unresolved.length,
        message: `${unresolved.length} recording${unresolved.length === 1 ? " is" : "s are"} already stopped on this device but still waiting to finish syncing. GPS remains off; reconnect and retry recovery.`,
      };
    }
    localRows = await listLocalActivities();
  }

  // Recovery is a global recording gate. Filtering first by the current page would
  // let a hiker start a second track while another route's recorder remains open.
  const localOpen = localRows.filter((activity) => !activity.endedAt);
  const locallyFinalized = localRows.filter((activity) => Boolean(activity.endedAt));

  let serverOpen: ServerOpenActivity[] | null = null;
  try {
    const response = await apiFetch("/api/activities", { cache: "no-store" });
    if (!response.ok) throw new Error("open activity lookup failed");
    const body = (await response.json()) as { openActivities?: unknown };
    if (!Array.isArray(body.openActivities)) throw new Error("open activity response was invalid");
    serverOpen = body.openActivities
      .filter(validServerOpenActivity)
      // A successful pending Stop is authoritative locally. A stale/read-lagged server
      // list must not be adopted as a new resumable session after we just finalized it.
      .filter((remote) => !locallyFinalized.some((local) =>
        local.remoteId === remote.id || (!local.remoteId && sameUnmappedActivity(local, remote)),
      ));
  } catch {
    // A single durable local session is still safe to offer while offline. With no local
    // evidence, retaining offline-start capability is preferable to inventing a conflict.
    if (localOpen.length === 0) return { status: "none" };
    if (localOpen.length === 1 && matchesRecoveryContext(localOpen[0], context)) {
      return {
        status: "recovered",
        activity: localOpen[0],
        serverVerified: false,
        message: "Recovered an unfinished recording from this device. Server status could not be checked.",
      };
    }
    if (localOpen.length === 1) {
      return {
        status: "blocked",
        candidateCount: 1,
        message: "An unfinished recording belongs to another route. GPS remains off; return to that route or finish the recording before starting a new one.",
      };
    }
    return {
      status: "blocked",
      candidateCount: localOpen.length,
      message: `Found ${localOpen.length} unfinished recordings on this device. GPS remains off because Klandagi cannot safely guess which one to resume.`,
    };
  }

  const unmatchedServer = [...serverOpen];
  const candidates: Array<{
    local?: LocalActivity;
    remote?: ServerOpenActivity;
    conflict?: boolean;
  }> = [];

  for (const local of localOpen) {
    const matchIndex = unmatchedServer.findIndex((remote) =>
      local.remoteId
        ? remote.id === local.remoteId
        : sameUnmappedActivity(local, remote),
    );
    if (matchIndex >= 0) {
      const [remote] = unmatchedServer.splice(matchIndex, 1);
      candidates.push({ local, remote });
    } else {
      // If a local row already knows its server ID, a successful server lookup that no
      // longer calls it open means Resume would send fixes to a finalized activity.
      candidates.push({ local, conflict: Boolean(local.remoteId) });
    }
  }
  for (const remote of unmatchedServer) candidates.push({ remote });

  if (candidates.length === 0) return { status: "none" };
  if (candidates.length > 1) {
    return {
      status: "blocked",
      candidateCount: candidates.length,
      message: `Found ${candidates.length} unfinished or conflicting recordings across this account and device. GPS remains off because Klandagi cannot safely guess which one to resume.`,
    };
  }

  const candidate = candidates[0];
  if (candidate.conflict && candidate.local) {
    return {
      status: "blocked",
      candidateCount: 1,
      message: "This device has an unfinished recording, but the server says that activity is already closed. GPS remains off to prevent track loss.",
    };
  }

  const candidateContext = candidate.local ?? candidate.remote;
  if (candidateContext && !matchesRecoveryContext(candidateContext, context)) {
    return {
      status: "blocked",
      candidateCount: 1,
      message: "An unfinished recording belongs to another route. GPS remains off; return to that route or finish the recording before starting a new one.",
    };
  }

  let local = candidate.local;
  if (!local && candidate.remote) {
    local = {
      id: crypto.randomUUID(),
      remoteId: candidate.remote.id,
      trailId: candidate.remote.trailId ?? undefined,
      planId: candidate.remote.planId ?? undefined,
      name: candidate.remote.name ?? undefined,
      startedAt: candidate.remote.startedAt,
      stats: candidate.remote.stats ?? undefined,
      pendingStop: false,
    };
  } else if (local && candidate.remote) {
    local.remoteId = candidate.remote.id;
    local.stats ??= candidate.remote.stats ?? undefined;
  }
  if (!local) return { status: "none" };
  await putLocalActivity(local);
  return {
    status: "recovered",
    activity: local,
    serverVerified: Boolean(candidate.remote),
    message: candidate.remote
      ? "Recovered one unfinished recording. GPS is paused until you choose Resume."
      : "Recovered one offline recording from this device. GPS is paused until you choose Resume.",
  };
}

/**
 * Resolve both the stable local ID and the remote ID accepted by older recorder builds.
 * Prefer a row whose `remoteId` matches: an old buggy finish could create a second row
 * keyed by the remote ID, and selecting that synthetic row would create another server
 * activity on the next flush.
 */
async function resolveLocalActivity(id: string): Promise<LocalActivity | null> {
  const rows = await listLocalActivities();
  return rows.find((row) => row.remoteId === id) ?? rows.find((row) => row.id === id) ?? null;
}

/** Server ID for direct API calls; null means this local session has not synced yet. */
export async function resolveRemoteActivityId(id: string): Promise<string | null> {
  const local = await resolveLocalActivity(id);
  // An ID with no local row is a legacy caller passing a server activity ID.
  return local ? local.remoteId ?? null : id;
}

/**
 * Persist live totals locally before an optional server snapshot write.
 *
 * Registration is synchronous even though IndexedDB is not. Recovery can therefore
 * wait for a cleanup-triggered write that its caller deliberately cannot await.
 */
export function saveLocalActivitySnapshot(
  id: string,
  stats: LocalActivity["stats"],
): Promise<string | null> {
  return trackSnapshotWrite((async () => {
    const local = await resolveLocalActivity(id);
    if (!local) return id;
    local.stats = stats;
    await putLocalActivity(local);
    return local.remoteId ?? null;
  })());
}

/** Start an activity even with no network. The returned ID is always the stable local ID. */
export async function beginActivity(input: {
  trailId?: string;
  planId?: string;
  name?: string;
}): Promise<{ id: string; remoteId?: string; offline: boolean }> {
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
    const res = await apiFetch("/api/activities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientActivityId: localId,
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
        return { id: localId, remoteId: data.id, offline: false };
      }
    }
  } catch {
    /* offline */
  }

  await putLocalActivity(local);
  return { id: localId, offline: true };
}

/**
 * Persist every fix before attempting the network. A successful server replay is
 * idempotent by clientPointId; a 409 means the point is novel and the activity is already
 * finalized, so it is surfaced once instead of remaining in an infinite retry loop.
 */
export async function saveActivityPoint(
  activityId: string,
  point: QueuedPoint,
): Promise<ActivityPointSaveResult> {
  const clientPointId = crypto.randomUUID();
  const recordedAt =
    typeof point.recordedAt === "string"
      ? point.recordedAt
      : point.recordedAt.toISOString();
  const local = await resolveLocalActivity(activityId);
  const remoteId = local ? local.remoteId ?? null : activityId;
  const queuedActivityId = remoteId ?? local?.id ?? activityId;

  await queueActivityPoint({
    id: clientPointId,
    activityId: queuedActivityId,
    lat: point.lat,
    lng: point.lng,
    elevation: point.elevation,
    recordedAt: new Date(recordedAt),
  }, { notify: false });

  if (!remoteId) {
    notifyPendingPointsChanged();
    return "queued";
  }

  try {
    const res = await apiFetch(`/api/activities/${encodeURIComponent(remoteId)}/points`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientPointId,
        lat: point.lat,
        lng: point.lng,
        elevation: point.elevation,
        recordedAt,
      }),
    });
    if (res.ok) {
      await markPointsSynced([clientPointId]);
      return "synced";
    }
    if (res.status === 409) {
      await discardPendingPoints([clientPointId]);
      return "rejected-finalized";
    }
  } catch {
    /* durable queue already contains the point */
  }
  notifyPendingPointsChanged();
  return "queued";
}

async function ensureRemoteId(local: LocalActivity): Promise<string | null> {
  if (local.remoteId) return local.remoteId;
  const inFlight = remoteIdPromises.get(local.id);
  if (inFlight) return inFlight;

  const creation = (async () => {
    const latest = await getLocalActivity(local.id);
    if (latest?.remoteId) {
      local.remoteId = latest.remoteId;
      return latest.remoteId;
    }
    try {
      const res = await apiFetch("/api/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientActivityId: local.id,
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
  })();

  remoteIdPromises.set(local.id, creation);
  try {
    return await creation;
  } finally {
    if (remoteIdPromises.get(local.id) === creation) remoteIdPromises.delete(local.id);
  }
}

async function movePendingPointsToRemote(localId: string, remoteId: string): Promise<void> {
  if (localId === remoteId) return;
  const db = await getOfflineDb();
  if (!db) return;
  const queued = await db.getAllFromIndex("pendingPoints", "by-activity", localId);
  for (const point of queued) {
    if (point.synced) continue;
    await db.put("pendingPoints", { ...point, activityId: remoteId });
  }
}

export async function flushPendingPoints(activityId: string): Promise<ActivityPointFlushResult> {
  const db = await getOfflineDb();
  if (!db) return { synced: 0, pending: 0, rejectedFinalized: 0 };
  const rows = await db.getAllFromIndex("pendingPoints", "by-activity", activityId);
  const pending = rows.filter((point) => !point.synced);
  let synced = 0;
  let rejectedFinalized = 0;
  for (const point of pending) {
    try {
      const res = await apiFetch(`/api/activities/${encodeURIComponent(activityId)}/points`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientPointId: point.id,
          lat: point.lat,
          lng: point.lng,
          elevation: point.elevation,
          recordedAt: point.recordedAt,
        }),
      });
      if (res.ok) {
        await markPointsSynced([point.id]);
        synced += 1;
        continue;
      }
      if (res.status === 409) {
        await discardPendingPoints([point.id]);
        rejectedFinalized += 1;
      }
    } catch {
      break;
    }
  }
  const remaining = await db.getAllFromIndex("pendingPoints", "by-activity", activityId);
  return {
    synced,
    rejectedFinalized,
    pending: remaining.filter((point) => !point.synced).length,
  };
}

function notifyFinalizedPointRejection(count: number): void {
  if (count < 1 || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("hike-points-queue-error", {
    detail: {
      message: `${count} GPS point${count === 1 ? " was" : "s were"} not saved because this activity was already finalized on the server.`,
    },
  }));
}

export async function finishActivity(
  activityId: string,
  stats: LocalActivity["stats"],
): Promise<FinishActivityResult> {
  const now = new Date().toISOString();
  // With no local row, preserve compatibility with an older caller that supplied a
  // server ID. New recorder sessions always have a stable local row.
  const local = (await resolveLocalActivity(activityId)) ?? {
    id: activityId,
    remoteId: activityId,
    startedAt: now,
    pendingStop: true,
  };
  const endedAt = local.endedAt ?? now;
  local.stats = stats;
  local.endedAt = endedAt;
  local.pendingStop = true;
  await putLocalActivity(local);

  const remoteId = await ensureRemoteId(local);
  if (!remoteId) return { synced: false, rejectedPoints: 0 };

  await movePendingPointsToRemote(local.id, remoteId);
  const points = await flushPendingPoints(remoteId);
  notifyFinalizedPointRejection(points.rejectedFinalized);
  // Never close the server activity while a durable point still has a retryable path.
  if (points.pending > 0) {
    return {
      synced: false,
      remoteId,
      rejectedPoints: points.rejectedFinalized,
    };
  }

  try {
    const res = await apiFetch(`/api/activities/${encodeURIComponent(remoteId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endedAt, stats }),
    });
    if (res.ok) {
      local.pendingStop = false;
      await putLocalActivity(local);
      return {
        synced: true,
        remoteId,
        rejectedPoints: points.rejectedFinalized,
      };
    }
  } catch {
    /* stay queued */
  }
  return {
    synced: false,
    remoteId,
    rejectedPoints: points.rejectedFinalized,
  };
}

async function runActivityQueueFlush(): Promise<void> {
  const locals = await listLocalActivities();
  for (const local of locals) {
    // A completed row is retained only as a local-to-remote identity record. Replaying
    // it used to POST a second server activity after an online recording was stopped.
    if (local.endedAt && !local.pendingStop) continue;

    const remoteId = await ensureRemoteId(local);
    if (!remoteId) continue;
    await movePendingPointsToRemote(local.id, remoteId);
    const points = await flushPendingPoints(remoteId);
    notifyFinalizedPointRejection(points.rejectedFinalized);
    if (points.pending > 0) continue;

    if (local.pendingStop && local.endedAt) {
      try {
        const res = await apiFetch(`/api/activities/${encodeURIComponent(remoteId)}`, {
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

/** Replay queued points and pending stops when the radio comes back. */
export async function flushActivityQueue(): Promise<void> {
  if (activityQueueFlushPromise) return activityQueueFlushPromise;
  activityQueueFlushPromise = runActivityQueueFlush();
  try {
    await activityQueueFlushPromise;
  } finally {
    activityQueueFlushPromise = null;
  }
}

/** Test-only reset; application code must retain the in-memory session cache. */
export async function __resetActivitySyncForTests(): Promise<void> {
  if (activityQueueFlushPromise) await activityQueueFlushPromise.catch(() => undefined);
  localActivityCache.clear();
  remoteIdPromises.clear();
  activityQueueFlushPromise = null;
}
