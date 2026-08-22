import { openDB, type DBSchema, type IDBPDatabase } from "idb";

const NAV_TRACK_DB_NAME = "hike-nav-tracks";
export const NAV_TRACK_DB_VERSION = 2;

export interface NavTrackPointInput {
  /**
   * Stable caller-generated id used to make a retry idempotent. When omitted,
   * appendNavPoint creates one for this call.
   */
  pointId?: string;
  /** Stable identity supplied by a sensor for deduplication across reloads. */
  sourceKey?: string;
  lat: number;
  lng: number;
  accuracy?: number;
  altitude?: number;
  recordedAt?: number;
}

export interface NavTrackPoint {
  pointId: string;
  sourceKey?: string;
  sessionId: string;
  /** Monotonic append order allocated inside the IndexedDB transaction. */
  sequence: number;
  lat: number;
  lng: number;
  accuracy?: number;
  altitude?: number;
  recordedAt: string;
}

export type NavTrackSessionStatus = "active" | "finished";

export interface NavTrackSessionSummary {
  id: string;
  packId: string;
  name: string;
  startedAt: string;
  status: NavTrackSessionStatus;
  finishedAt?: string;
  pointCount: number;
  nextSequence: number;
  lastPointAt?: string;
}

export interface NavTrackSession extends NavTrackSessionSummary {
  points: NavTrackPoint[];
}

interface ActiveNavSession {
  packId: string;
  sessionId: string;
}

interface NavTrackDB extends DBSchema {
  sessions: {
    key: string;
    value: NavTrackSessionSummary;
    indexes: {
      "by-pack": string;
      "by-started-at": string;
    };
  };
  points: {
    /**
     * One record per accepted fix. There is deliberately no sampling or
     * retention cutoff: quota failure is reported instead of deleting history.
     */
    key: [string, number];
    value: NavTrackPoint;
    indexes: {
      "by-session": string;
      "by-point-id": string;
      "by-session-source": [string, string];
    };
  };
  activeSessions: {
    key: string;
    value: ActiveNavSession;
  };
}

interface LegacyNavTrackPoint {
  lat: number;
  lng: number;
  accuracy?: number;
  altitude?: number;
  recordedAt: string;
}

interface LegacyNavTrackSession {
  id: string;
  packId: string;
  name: string;
  startedAt: string;
  points: LegacyNavTrackPoint[];
}

export type NavTrackStorageErrorCode =
  | "unavailable"
  | "open-failed"
  | "invalid-input"
  | "not-found"
  | "finished"
  | "quota"
  | "write-failed";

export class NavTrackStorageError extends Error {
  constructor(
    public readonly code: NavTrackStorageErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "NavTrackStorageError";
  }
}

export interface ResumeNavSessionResult {
  sessionId: string;
  resumed: boolean;
}

export interface NavTrackExport {
  format: "klandagi-nav-track";
  version: 2;
  exportedAt: string;
  session: NavTrackSessionSummary;
  points: NavTrackPoint[];
}

let dbPromise: Promise<IDBPDatabase<NavTrackDB>> | null = null;

/**
 * Serializes operations made by this document. IndexedDB serializes write
 * transactions across tabs; this queue additionally preserves JavaScript call
 * order inside one document and lets retries retain their point id.
 */
const operationQueue = new Map<string, Promise<void>>();

function validIdentity(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}

function validPointIdentity(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512;
}

function validName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 1_024;
}

function validIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validLegacyPoint(point: unknown): point is LegacyNavTrackPoint {
  if (!point || typeof point !== "object") return false;
  const candidate = point as Partial<LegacyNavTrackPoint>;
  return (
    typeof candidate.lat === "number" &&
    Number.isFinite(candidate.lat) &&
    candidate.lat >= -90 &&
    candidate.lat <= 90 &&
    typeof candidate.lng === "number" &&
    Number.isFinite(candidate.lng) &&
    candidate.lng >= -180 &&
    candidate.lng <= 180 &&
    (candidate.accuracy === undefined ||
      (Number.isFinite(candidate.accuracy) && candidate.accuracy >= 0)) &&
    (candidate.altitude === undefined || Number.isFinite(candidate.altitude)) &&
    validIsoDate(candidate.recordedAt)
  );
}

function validLegacySession(session: unknown): session is LegacyNavTrackSession {
  if (!session || typeof session !== "object") return false;
  const candidate = session as Partial<LegacyNavTrackSession>;
  return (
    validIdentity(candidate.id) &&
    validIdentity(candidate.packId) &&
    validName(candidate.name) &&
    validIsoDate(candidate.startedAt) &&
    Array.isArray(candidate.points) &&
    candidate.points.every(validLegacyPoint)
  );
}

function newestLegacySessionByPack(sessions: LegacyNavTrackSession[]) {
  const newest = new Map<string, LegacyNavTrackSession>();
  for (const session of sessions) {
    const current = newest.get(session.packId);
    if (
      !current ||
      Date.parse(session.startedAt) > Date.parse(current.startedAt) ||
      (session.startedAt === current.startedAt && session.id.localeCompare(current.id) > 0)
    ) {
      newest.set(session.packId, session);
    }
  }
  return newest;
}

function migrateV1Sessions(event: IDBVersionChangeEvent) {
  const transaction = (event.target as IDBOpenDBRequest).transaction;
  if (!transaction) return;

  const sessions = transaction.objectStore("sessions");
  const points = transaction.objectStore("points");
  const activeSessions = transaction.objectStore("activeSessions");
  const request = sessions.getAll();

  request.onerror = () => transaction.abort();
  request.onsuccess = () => {
    const legacySessions = request.result;
    if (!legacySessions.every(validLegacySession)) {
      // Abort the version-change transaction. The browser keeps the v1
      // database intact instead of silently discarding a malformed old track.
      transaction.abort();
      return;
    }

    const newest = newestLegacySessionByPack(legacySessions);
    for (const legacy of legacySessions) {
      const active = newest.get(legacy.packId)?.id === legacy.id;
      const summary: NavTrackSessionSummary = {
        id: legacy.id,
        packId: legacy.packId,
        name: legacy.name,
        startedAt: legacy.startedAt,
        status: active ? "active" : "finished",
        pointCount: legacy.points.length,
        nextSequence: legacy.points.length,
        lastPointAt: legacy.points.at(-1)?.recordedAt,
      };
      sessions.put(summary);

      legacy.points.forEach((point, sequence) => {
        points.add({
          ...point,
          pointId: `legacy:${legacy.id}:${sequence}`,
          sessionId: legacy.id,
          sequence,
        } satisfies NavTrackPoint);
      });

      if (active) {
        activeSessions.put({ packId: legacy.packId, sessionId: legacy.id });
      }
    }
  };
}

function getDb() {
  if (typeof indexedDB === "undefined") return null;
  if (!dbPromise) {
    dbPromise = openDB<NavTrackDB>(NAV_TRACK_DB_NAME, NAV_TRACK_DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, transaction, event) {
        const sessions =
          oldVersion === 0
            ? db.createObjectStore("sessions", { keyPath: "id" })
            : transaction.objectStore("sessions");
        if (!sessions.indexNames.contains("by-pack")) {
          sessions.createIndex("by-pack", "packId");
        }
        if (!sessions.indexNames.contains("by-started-at")) {
          sessions.createIndex("by-started-at", "startedAt");
        }

        if (oldVersion < 2) {
          const points = db.createObjectStore("points", {
            keyPath: ["sessionId", "sequence"],
          });
          points.createIndex("by-session", "sessionId");
          points.createIndex("by-point-id", "pointId", { unique: true });
          points.createIndex("by-session-source", ["sessionId", "sourceKey"], {
            unique: true,
          });
          db.createObjectStore("activeSessions", { keyPath: "packId" });
          if (oldVersion === 1) migrateV1Sessions(event);
        }
      },
      blocking() {
        const opening = dbPromise;
        void opening?.then((db) => {
          db.close();
          if (dbPromise === opening) dbPromise = null;
        });
      },
      terminated() {
        dbPromise = null;
      },
    });
  }
  return dbPromise;
}

async function requireDb(): Promise<IDBPDatabase<NavTrackDB>> {
  const opening = getDb();
  if (!opening) {
    throw new NavTrackStorageError(
      "unavailable",
      "This browser cannot access offline track storage.",
    );
  }
  try {
    return await opening;
  } catch (error) {
    if (dbPromise === opening) dbPromise = null;
    throw new NavTrackStorageError(
      "open-failed",
      "Offline track storage could not be opened.",
      { cause: error },
    );
  }
}

function storageWriteError(error: unknown): NavTrackStorageError {
  if (error instanceof NavTrackStorageError) return error;
  if (error instanceof DOMException && error.name === "QuotaExceededError") {
    return new NavTrackStorageError(
      "quota",
      "This device is out of space for the breadcrumb track.",
      { cause: error },
    );
  }
  return new NavTrackStorageError(
    "write-failed",
    "The breadcrumb track could not be saved on this device.",
    { cause: error },
  );
}

async function enqueueSessionOperation<T>(
  sessionId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = operationQueue.get(sessionId) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(operation);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  operationQueue.set(sessionId, tail);
  try {
    return await run;
  } finally {
    if (operationQueue.get(sessionId) === tail) operationQueue.delete(sessionId);
  }
}

function validateSessionIdentity(packId: string, name: string) {
  if (!validIdentity(packId) || !validName(name)) {
    throw new NavTrackStorageError(
      "invalid-input",
      "The route identity is invalid, so its breadcrumb track was not opened.",
    );
  }
}

function validatePoint(point: NavTrackPointInput) {
  if (
    !Number.isFinite(point.lat) ||
    point.lat < -90 ||
    point.lat > 90 ||
    !Number.isFinite(point.lng) ||
    point.lng < -180 ||
    point.lng > 180 ||
    (point.accuracy !== undefined &&
      (!Number.isFinite(point.accuracy) || point.accuracy < 0)) ||
    (point.altitude !== undefined && !Number.isFinite(point.altitude)) ||
    (point.recordedAt !== undefined && !Number.isFinite(point.recordedAt))
  ) {
    throw new NavTrackStorageError(
      "invalid-input",
      "An invalid GPS fix was not added to the breadcrumb track.",
    );
  }
  if (point.pointId !== undefined && !validPointIdentity(point.pointId)) {
    throw new NavTrackStorageError(
      "invalid-input",
      "The breadcrumb point identity is invalid.",
    );
  }
  if (point.sourceKey !== undefined && !validPointIdentity(point.sourceKey)) {
    throw new NavTrackStorageError(
      "invalid-input",
      "The breadcrumb sensor-fix identity is invalid.",
    );
  }
}

function newSession(packId: string, name: string): NavTrackSessionSummary {
  return {
    id: crypto.randomUUID(),
    packId,
    name,
    startedAt: new Date().toISOString(),
    status: "active",
    pointCount: 0,
    nextSequence: 0,
  };
}

/**
 * Returns the active track for this canonical route, or creates one atomically.
 * A remount, refresh, or second tab therefore resumes the same track instead of
 * hiding the earlier breadcrumb behind a blank session.
 */
export async function resumeOrStartNavSession(
  packId: string,
  name: string,
): Promise<ResumeNavSessionResult> {
  validateSessionIdentity(packId, name);
  const db = await requireDb();
  try {
    const tx = db.transaction(["sessions", "activeSessions"], "readwrite");
    const sessions = tx.objectStore("sessions");
    const activeSessions = tx.objectStore("activeSessions");
    const pointer = await activeSessions.get(packId);
    const pointed = pointer ? await sessions.get(pointer.sessionId) : undefined;

    if (pointed?.status === "active" && pointed.packId === packId) {
      if (pointed.name !== name) await sessions.put({ ...pointed, name });
      await tx.done;
      return { sessionId: pointed.id, resumed: true };
    }
    if (pointer) await activeSessions.delete(packId);

    // Forward-repair a missing/corrupt pointer without abandoning an active
    // session. If corruption left several active records, deterministically keep
    // the newest and close the others.
    const activeCandidates = (await sessions.index("by-pack").getAll(packId))
      .filter((session) => session.status === "active")
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id));
    const existing = activeCandidates[0];
    if (existing) {
      for (const duplicate of activeCandidates.slice(1)) {
        await sessions.put({ ...duplicate, status: "finished" });
      }
      const current = existing.name === name ? existing : { ...existing, name };
      if (current !== existing) await sessions.put(current);
      await activeSessions.put({ packId, sessionId: current.id });
      await tx.done;
      return { sessionId: current.id, resumed: true };
    }

    const session = newSession(packId, name);
    await sessions.add(session);
    await activeSessions.put({ packId, sessionId: session.id });
    await tx.done;
    return { sessionId: session.id, resumed: false };
  } catch (error) {
    throw storageWriteError(error);
  }
}

/** Backward-compatible id-only wrapper. It resumes an existing active session. */
export async function startNavSession(packId: string, name: string): Promise<string> {
  return (await resumeOrStartNavSession(packId, name)).sessionId;
}

export async function appendNavPoint(
  sessionId: string,
  input: NavTrackPointInput,
): Promise<NavTrackPoint> {
  if (!validIdentity(sessionId)) {
    throw new NavTrackStorageError("invalid-input", "The breadcrumb session is invalid.");
  }
  validatePoint(input);
  const pointId = input.pointId ?? crypto.randomUUID();

  return enqueueSessionOperation(sessionId, async () => {
    const db = await requireDb();
    try {
      const tx = db.transaction(["sessions", "points"], "readwrite");
      const sessions = tx.objectStore("sessions");
      const points = tx.objectStore("points");
      const sourceMatch = input.sourceKey
        ? await points.index("by-session-source").get([sessionId, input.sourceKey])
        : undefined;
      if (sourceMatch) {
        await tx.done;
        return sourceMatch;
      }
      const existing = await points.index("by-point-id").get(pointId);
      if (existing) {
        if (existing.sessionId !== sessionId) {
          throw new NavTrackStorageError(
            "invalid-input",
            "The breadcrumb point belongs to a different session.",
          );
        }
        await tx.done;
        return existing;
      }

      const session = await sessions.get(sessionId);
      if (!session) {
        throw new NavTrackStorageError(
          "not-found",
          "The active breadcrumb session could not be found.",
        );
      }
      if (session.status !== "active") {
        throw new NavTrackStorageError(
          "finished",
          "This breadcrumb session is already finished.",
        );
      }

      const recordedAt = new Date(input.recordedAt ?? Date.now()).toISOString();
      const point: NavTrackPoint = {
        pointId,
        sourceKey: input.sourceKey,
        sessionId,
        sequence: session.nextSequence,
        lat: input.lat,
        lng: input.lng,
        accuracy: input.accuracy,
        altitude: input.altitude,
        recordedAt,
      };
      await points.add(point);
      await sessions.put({
        ...session,
        pointCount: session.pointCount + 1,
        nextSequence: session.nextSequence + 1,
        lastPointAt: recordedAt,
      });
      await tx.done;
      return point;
    } catch (error) {
      throw storageWriteError(error);
    }
  });
}

export async function getNavSession(sessionId: string): Promise<NavTrackSession | null> {
  if (!validIdentity(sessionId)) return null;
  const db = await requireDb();
  const tx = db.transaction(["sessions", "points"], "readonly");
  const [session, storedPoints] = await Promise.all([
    tx.objectStore("sessions").get(sessionId),
    tx.objectStore("points").index("by-session").getAll(sessionId),
  ]);
  await tx.done;
  if (!session) return null;
  const points = storedPoints.sort((a, b) => a.sequence - b.sequence);
  return { ...session, points };
}

export async function getActiveNavSession(packId: string): Promise<NavTrackSession | null> {
  if (!validIdentity(packId)) return null;
  const db = await requireDb();
  const pointer = await db.get("activeSessions", packId);
  if (!pointer) return null;
  const session = await getNavSession(pointer.sessionId);
  return session?.status === "active" && session.packId === packId ? session : null;
}

export async function listNavSessions(options: {
  packId?: string;
  status?: NavTrackSessionStatus;
} = {}): Promise<NavTrackSessionSummary[]> {
  if (options.packId !== undefined && !validIdentity(options.packId)) return [];
  const db = await requireDb();
  const sessions = options.packId
    ? await db.getAllFromIndex("sessions", "by-pack", options.packId)
    : await db.getAll("sessions");
  return sessions
    .filter((session) => options.status === undefined || session.status === options.status)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id));
}

export async function finishNavSession(
  sessionId: string,
  finishedAt = Date.now(),
): Promise<NavTrackSessionSummary> {
  if (!validIdentity(sessionId) || !Number.isFinite(finishedAt)) {
    throw new NavTrackStorageError("invalid-input", "The breadcrumb finish request is invalid.");
  }
  return enqueueSessionOperation(sessionId, async () => {
    const db = await requireDb();
    try {
      const tx = db.transaction(["sessions", "activeSessions"], "readwrite");
      const sessions = tx.objectStore("sessions");
      const activeSessions = tx.objectStore("activeSessions");
      const session = await sessions.get(sessionId);
      if (!session) {
        throw new NavTrackStorageError("not-found", "The breadcrumb session was not found.");
      }
      if (session.status === "finished") {
        await tx.done;
        return session;
      }
      const finished = {
        ...session,
        status: "finished" as const,
        finishedAt: new Date(finishedAt).toISOString(),
      };
      await sessions.put(finished);
      const pointer = await activeSessions.get(session.packId);
      if (pointer?.sessionId === session.id) await activeSessions.delete(session.packId);
      await tx.done;
      return finished;
    } catch (error) {
      throw storageWriteError(error);
    }
  });
}

export async function deleteNavSession(sessionId: string): Promise<boolean> {
  if (!validIdentity(sessionId)) return false;
  return enqueueSessionOperation(sessionId, async () => {
    const db = await requireDb();
    try {
      const tx = db.transaction(["sessions", "points", "activeSessions"], "readwrite");
      const sessions = tx.objectStore("sessions");
      const session = await sessions.get(sessionId);
      if (!session) {
        await tx.done;
        return false;
      }

      let cursor = await tx.objectStore("points").index("by-session").openCursor(sessionId);
      while (cursor) {
        await cursor.delete();
        cursor = await cursor.continue();
      }
      await sessions.delete(sessionId);
      const activeSessions = tx.objectStore("activeSessions");
      const pointer = await activeSessions.get(session.packId);
      if (pointer?.sessionId === session.id) await activeSessions.delete(session.packId);
      await tx.done;
      return true;
    } catch (error) {
      throw storageWriteError(error);
    }
  });
}

export async function exportNavSession(sessionId: string): Promise<NavTrackExport> {
  const session = await getNavSession(sessionId);
  if (!session) {
    throw new NavTrackStorageError("not-found", "The breadcrumb session was not found.");
  }
  const { points, ...summary } = session;
  return {
    format: "klandagi-nav-track",
    version: 2,
    exportedAt: new Date().toISOString(),
    session: summary,
    points,
  };
}

export async function serializeNavSessionExport(sessionId: string): Promise<string> {
  return JSON.stringify(await exportNavSession(sessionId), null, 2);
}

export function formatNavTrackStorageError(error: unknown): string {
  if (error instanceof NavTrackStorageError) return error.message;
  return "The breadcrumb track is not being saved. Backtrack remains available only while this screen stays open.";
}

/** Test-only connection reset so fake IndexedDB databases can be recreated. */
export async function resetNavTrackDbForTests(): Promise<void> {
  const opening = dbPromise;
  dbPromise = null;
  operationQueue.clear();
  if (!opening) return;
  try {
    (await opening).close();
  } catch {
    // A rejected open has no live connection to close.
  }
}
