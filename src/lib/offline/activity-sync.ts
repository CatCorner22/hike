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
  /**
   * Idempotency key sent as `clientActivityId` when creating the server row. Defaults to
   * `id`; re-homing rotates it, because the server keys activities by this value globally
   * and answers 409 when another owner already holds it — reusing `id` after an owner
   * change would make re-creation impossible for an activity that was begun online.
   */
  syncId?: string;
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
  /**
   * The server answered 404 for the activity itself: it does not exist for the current
   * owner. Retrying the same request can never succeed — the caller must re-home the
   * recording instead. The point that hit the 404 stays durably queued.
   */
  activityUnreachable: boolean;
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

async function deleteLocalActivity(id: string) {
  localActivityCache.delete(id);
  const db = await getOfflineDb();
  if (!db || !db.objectStoreNames.contains("localActivities")) return;
  await db.delete("localActivities", id);
}

/**
 * The server no longer recognizes this activity for the current owner — the cookie was
 * cleared, SESSION_SECRET rotated, or the row was deleted elsewhere. Every request to the
 * old remote ID answers 404 forever, so without this the pending-stop reconciliation loop
 * blocks recording on this device permanently while telling the hiker to "retry".
 *
 * Re-homing forgets the dead remote identity and moves any queued points back under the
 * stable local ID, which puts the recording on the same path an offline-recorded hike
 * takes: the next flush re-creates the activity under whoever the current owner is and
 * replays every point into it. No GPS data is lost. `syncId` is rotated because the old
 * key may still name another owner's row on the server (409 on reuse).
 */
async function rehomeLocalActivity(local: LocalActivity): Promise<void> {
  const deadRemoteId = local.remoteId;
  local.remoteId = undefined;
  local.syncId = crypto.randomUUID();
  remoteIdPromises.delete(local.id);
  if (deadRemoteId && deadRemoteId !== local.id) {
    await movePendingPoints(deadRemoteId, local.id);
  }
  await putLocalActivity(local);
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
  let localOpen = localRows.filter((activity) => !activity.endedAt);
  const locallyFinalized = localRows.filter((activity) => Boolean(activity.endedAt));

  // Ghost sweep: an open row with no server copy and not a single queued point is a
  // failed start (a double-tapped Start button, a crash before the first fix), not a
  // recording — there is nothing under it to lose. Left in place, two such rows made
  // the ">1 unfinished recordings" block PERMANENT: Retry re-counted the same ghosts
  // forever and the device could never record again. Swept only when more than one
  // open row exists; a single ghost is still offered for resume, preserving the old
  // behavior for the ordinary crash-on-start case.
  if (localOpen.length > 1) {
    const db = await getOfflineDb();
    const survivors: LocalActivity[] = [];
    for (const row of localOpen) {
      if (row.remoteId) {
        survivors.push(row);
        continue;
      }
      const queued = db
        ? (await db.getAllFromIndex("pendingPoints", "by-activity", row.id)).filter(
            (point) => !point.synced,
          )
        : [];
      if (queued.length > 0) survivors.push(row);
      else await deleteLocalActivity(row.id);
    }
    localOpen = survivors;
  }

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
    return resolveRemoteConflict(candidate.local, context);
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
 * An open local recording whose remote ID is missing from the owner's open-activity
 * list. "Missing" has two very different meanings, and only a direct lookup can tell
 * them apart:
 *
 * - 404: the activity does not exist for the CURRENT owner — the cookie was cleared or
 *   SESSION_SECRET rotated, so the server will refuse this remote ID forever. Blocking
 *   on it would disable recording on this device permanently. Re-home instead: the
 *   session continues as a device-local recording and syncs under the current owner.
 * - 200 with endedAt: the activity was genuinely finished elsewhere (another tab or
 *   device). With nothing queued locally there is no track to lose — adopt the final
 *   state and clear the gate. With queued points, keep the protective block: resuming
 *   would append to a finalized track, and flushing would discard the points.
 * - 200 still open (a read-lagged list) or a failed lookup: keep the protective block;
 *   the next recovery attempt re-checks.
 */
async function resolveRemoteConflict(
  local: LocalActivity,
  context: { trailId?: string; planId?: string },
): Promise<OpenActivityRecovery> {
  const blocked: OpenActivityRecovery = {
    status: "blocked",
    candidateCount: 1,
    message: "This device has an unfinished recording, but the server says that activity is already closed. GPS remains off to prevent track loss.",
  };
  const remoteId = local.remoteId;
  if (!remoteId) return blocked;
  try {
    const response = await apiFetch(`/api/activities/${encodeURIComponent(remoteId)}`, {
      cache: "no-store",
    });
    if (response.status === 404) {
      await rehomeLocalActivity(local);
      if (!matchesRecoveryContext(local, context)) {
        return {
          status: "blocked",
          candidateCount: 1,
          message: "An unfinished recording belongs to another route. GPS remains off; return to that route or finish the recording before starting a new one.",
        };
      }
      return {
        status: "recovered",
        activity: local,
        serverVerified: false,
        message: "Recovered an unfinished recording from this device. Its server copy is no longer reachable, so it will sync as a new activity.",
      };
    }
    if (!response.ok) return blocked;
    const body = (await response.json()) as { activity?: { endedAt?: string | null } };
    const endedAt = body.activity?.endedAt;
    if (typeof endedAt === "string" && endedAt.length > 0) {
      const db = await getOfflineDb();
      const queued = db
        ? (await db.getAllFromIndex("pendingPoints", "by-activity", local.id)).filter(
            (point) => !point.synced,
          )
        : [];
      const queuedRemote = db && remoteId !== local.id
        ? (await db.getAllFromIndex("pendingPoints", "by-activity", remoteId)).filter(
            (point) => !point.synced,
          )
        : [];
      if (queued.length > 0 || queuedRemote.length > 0) return blocked;
      local.endedAt = endedAt;
      local.pendingStop = false;
      await putLocalActivity(local);
      return { status: "none" };
    }
    return blocked;
  } catch {
    return blocked;
  }
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
}): Promise<{ id: string; remoteId?: string; offline: boolean; serverError?: string }> {
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
    const data = (await res.json().catch(() => null)) as { id?: string; error?: string } | null;
    if (res.ok && data?.id) {
      local.remoteId = data.id;
      await putLocalActivity(local);
      return { id: localId, remoteId: data.id, offline: false };
    }
    const serverError =
      typeof data?.error === "string" && data.error.trim()
        ? data.error.trim()
        : `The server did not start this activity (${res.status}).`;
    await putLocalActivity(local);
    return { id: localId, offline: true, serverError };
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
    if (res.status === 404 && local) {
      // The owner changed under a live recording (cookie cleared, secret rotated). The
      // dead remote ID would 404 for every later fix as well, so re-home now, re-create
      // the activity under the current owner, and retry this one point once. Live sync
      // then continues for the rest of the hike instead of silently queueing everything.
      await rehomeLocalActivity(local);
      const revivedId = await ensureRemoteId(local);
      if (revivedId) {
        await movePendingPoints(local.id, revivedId);
        const retry = await flushPendingPoints(revivedId);
        if (retry.pending === 0 && !retry.activityUnreachable) return "synced";
      }
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
          clientActivityId: local.syncId ?? local.id,
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

async function movePendingPoints(fromActivityId: string, toActivityId: string): Promise<void> {
  if (fromActivityId === toActivityId) return;
  const db = await getOfflineDb();
  if (!db) return;
  const queued = await db.getAllFromIndex("pendingPoints", "by-activity", fromActivityId);
  for (const point of queued) {
    if (point.synced) continue;
    await db.put("pendingPoints", { ...point, activityId: toActivityId });
  }
}

export async function flushPendingPoints(activityId: string): Promise<ActivityPointFlushResult> {
  const db = await getOfflineDb();
  if (!db) return { synced: 0, pending: 0, rejectedFinalized: 0, activityUnreachable: false };
  const rows = await db.getAllFromIndex("pendingPoints", "by-activity", activityId);
  const pending = rows.filter((point) => !point.synced);
  let synced = 0;
  let rejectedFinalized = 0;
  let activityUnreachable = false;
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
        continue;
      }
      if (res.status === 404) {
        // The activity itself is gone for this owner. Every further point would 404
        // identically, so stop instead of burning a request per point; the points stay
        // queued and the caller re-homes the recording.
        activityUnreachable = true;
        break;
      }
    } catch {
      break;
    }
  }
  const remaining = await db.getAllFromIndex("pendingPoints", "by-activity", activityId);
  return {
    synced,
    rejectedFinalized,
    activityUnreachable,
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
  const resolved = await resolveLocalActivity(activityId);
  // With no local row, preserve compatibility with an older caller that supplied a
  // server ID. New recorder sessions always have a stable local row.
  const local = resolved ?? {
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
  return finishLocalActivity(local, endedAt, stats, { fabricated: resolved === null });
}

async function finishLocalActivity(
  local: LocalActivity,
  endedAt: string,
  stats: LocalActivity["stats"],
  options: { fabricated: boolean; rehomed?: boolean },
): Promise<FinishActivityResult> {
  const remoteId = await ensureRemoteId(local);
  if (!remoteId) return { synced: false, rejectedPoints: 0 };

  await movePendingPoints(local.id, remoteId);
  const points = await flushPendingPoints(remoteId);
  notifyFinalizedPointRejection(points.rejectedFinalized);
  if (points.activityUnreachable) {
    return handleUnreachableFinish(local, endedAt, stats, options, points.rejectedFinalized);
  }
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
    if (res.status === 404) {
      return handleUnreachableFinish(local, endedAt, stats, options, points.rejectedFinalized);
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

/**
 * The server answered 404 for an activity this device believes it owns: the owner
 * changed (cleared cookies, rotated SESSION_SECRET) or the row was deleted elsewhere.
 * Left alone, the pending-stop row would fail the same way on every retry and the
 * recovery gate would keep GPS off on this device forever.
 *
 * A real recording is re-homed and finished once more under the current owner, keeping
 * every queued point. A fabricated row (an ID we never recorded against) with nothing
 * queued under it is deleted instead — it represents no local data, and persisting it
 * would manufacture the same permanent block out of a stale link.
 */
async function handleUnreachableFinish(
  local: LocalActivity,
  endedAt: string,
  stats: LocalActivity["stats"],
  options: { fabricated: boolean; rehomed?: boolean },
  rejectedPoints: number,
): Promise<FinishActivityResult> {
  if (options.rehomed) {
    // The re-created activity is unreachable too — something beyond identity rotation
    // is wrong. Stay pending rather than looping.
    return { synced: false, remoteId: local.remoteId, rejectedPoints };
  }
  if (options.fabricated) {
    const db = await getOfflineDb();
    const queued = db
      ? (await db.getAllFromIndex("pendingPoints", "by-activity", local.id)).filter(
          (point) => !point.synced,
        )
      : [];
    if (queued.length === 0) {
      await deleteLocalActivity(local.id);
      return { synced: false, rejectedPoints };
    }
  }
  await rehomeLocalActivity(local);
  return finishLocalActivity(local, endedAt, stats, { ...options, rehomed: true });
}

async function runActivityQueueFlush(): Promise<void> {
  const locals = await listLocalActivities();
  for (const local of locals) {
    // A completed row is retained only as a local-to-remote identity record. Replaying
    // it used to POST a second server activity after an online recording was stopped.
    if (local.endedAt && !local.pendingStop) continue;
    await flushOneLocalActivity(local, { rehomed: false });
  }
}

async function flushOneLocalActivity(
  local: LocalActivity,
  options: { rehomed: boolean },
): Promise<void> {
  const remoteId = await ensureRemoteId(local);
  if (!remoteId) return;
  await movePendingPoints(local.id, remoteId);
  const points = await flushPendingPoints(remoteId);
  notifyFinalizedPointRejection(points.rejectedFinalized);
  if (points.activityUnreachable) {
    // Same permanent-404 condition as in finishActivity: retrying the dead remote ID
    // can never succeed, so re-home once and replay under the current owner.
    if (!options.rehomed) {
      await rehomeLocalActivity(local);
      await flushOneLocalActivity(local, { rehomed: true });
    }
    return;
  }
  if (points.pending > 0) return;

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
        return;
      }
      if (res.status === 404 && !options.rehomed) {
        await rehomeLocalActivity(local);
        await flushOneLocalActivity(local, { rehomed: true });
      }
    } catch {
      /* still offline */
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
