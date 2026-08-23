import { syncOverdueNotification } from "@/lib/platform/overdue-notification";
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { PositionSource } from "@/lib/safety/emergency";
export { partySizeLine } from "@/lib/safety/party";

export interface IceProfile {
  name: string;
  iceName: string;
  icePhone: string;
  medical: string;
  partySize: number;
  /**
   * Whether a person actually stated the party size, as opposed to inheriting
   * the default of 1. A leave-behind card that says "Party size: 1" for a group
   * of nine sends one searcher to look for one person, and nothing on the card
   * warns that the number was never confirmed.
   */
  partySizeConfirmed?: boolean;
  bloodType?: string;
  challenge?: string;
  password?: string;
  /**
   * Who has jurisdiction where this trip is, and the number to reach them.
   *
   * The leave-behind card had a field for the vehicle's license plate and none
   * for the agency that would run the search. "Call the responsible county
   * sheriff, park dispatch, or 911" is a sentence a hiker can answer in advance
   * and a frightened contact at 3am cannot — and the hour they spend finding
   * out is the first hour of the search.
   */
  responderAgency?: string;
  responderPhone?: string;
}



export interface SafetyWaypoint {
  id: string;
  packId: string;
  kind: "water" | "junction" | "camp" | "note" | "lkp" | "rp" | "orp" | "ap" | "cf" | "hr";
  lat: number;
  lng: number;
  note?: string;
  recordedAt: string;
  accuracyM?: number;
  positionSource?: PositionSource;
  positionRecordedAt?: string;
}

export interface FieldPhoto {
  id: string;
  packId: string;
  waypointId: string;
  capturedAt: string;
  mediaType: "image/jpeg";
  width: number;
  height: number;
  size: number;
  blob: Blob;
}

export type WaypointWriteResult =
  | { ok: true; waypoint: SafetyWaypoint }
  | { ok: false; message: string };

export type WaypointReadResult =
  | { ok: true; waypoints: SafetyWaypoint[] }
  | { ok: false; message: string };

export type WaypointDeleteResult =
  | { ok: true; waypoint: SafetyWaypoint; photos: FieldPhoto[] }
  | { ok: false; message: string };

export type PhotoWriteResult =
  | { ok: true; photo: FieldPhoto }
  | { ok: false; message: string };

export type PhotoReadResult =
  | { ok: true; photos: FieldPhoto[] }
  | { ok: false; message: string };

export interface OverdueAlarm {
  returnAt: string;
  resolvedLocal?: string;
  timeZone?: string;
  utcOffset?: string;
}

export interface CheckinEntry {
  id: string;
  packId: string;
  recordedAt: string;
  lat?: number;
  lng?: number;
  note?: string;
}

export interface CheckinSettings {
  intervalMin: number;
  enabled: boolean;
  /** When the interval was armed. First due is this + interval if no I'm OK yet. */
  armedAt?: string;
}

interface SafetyDB extends DBSchema {
  profile: { key: string; value: IceProfile & { id: string } };
  waypoints: { key: string; value: SafetyWaypoint; indexes: { "by-pack": string } };
  overdue: { key: string; value: OverdueAlarm & { id: string } };
  checkins: { key: string; value: CheckinEntry; indexes: { "by-pack": string } };
  checkinSettings: { key: string; value: CheckinSettings & { id: string } };
  photos: {
    key: string;
    value: FieldPhoto;
    indexes: { "by-pack": string; "by-waypoint": string };
  };
}

const SAFETY_DB_VERSION = 3;

/**
 * Opening IndexedDB can hang indefinitely: if another tab still holds an older
 * version open, the upgrade blocks and the promise simply never settles. Past
 * this, degrade instead of waiting — callers all handle a null database.
 */
const DB_OPEN_TIMEOUT_MS = 5_000;

let dbPromise: Promise<IDBPDatabase<SafetyDB> | null> | null = null;
let openAttempt: Promise<IDBPDatabase<SafetyDB>> | null = null;
let liveDb: IDBPDatabase<SafetyDB> | null = null;

/**
 * The safety database, or null if this device cannot give us one right now.
 *
 * Both failure modes here used to be permanent and silent. A rejected `openDB`
 * — storage denied in a private window, quota exhausted, a corrupt store — was
 * cached in `dbPromise` forever, and every later call re-threw it. A blocked
 * upgrade never settled at all. No caller has a `catch`: `readiness-gate` and
 * the safety panel simply never set their state, and `unlockIfReady` on the
 * navigate page never reached `setNavUnlocked(true)`, so **Navigate stayed
 * locked with nothing on screen explaining why**.
 *
 * Now a failure resolves to null (which every caller already handles as "no
 * stored profile") and clears the cache so the next call genuinely retries.
 */
export function getSafetyDb(): Promise<IDBPDatabase<SafetyDB> | null> | null {
  if (typeof indexedDB === "undefined") return null;
  if (!dbPromise) dbPromise = openSafetyDb();
  return dbPromise;
}

function forgetSafetyDb() {
  dbPromise = null;
  openAttempt = null;
  liveDb = null;
}

async function openSafetyDb(): Promise<IDBPDatabase<SafetyDB> | null> {
  if (!openAttempt) {
    openAttempt = openDB<SafetyDB>("hike-safety", SAFETY_DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore("profile", { keyPath: "id" });
          const waypoints = db.createObjectStore("waypoints", { keyPath: "id" });
          waypoints.createIndex("by-pack", "packId");
          db.createObjectStore("overdue", { keyPath: "id" });
        }
        if (oldVersion < 2) {
          const checkins = db.createObjectStore("checkins", { keyPath: "id" });
          checkins.createIndex("by-pack", "packId");
          db.createObjectStore("checkinSettings", { keyPath: "id" });
        }
        if (oldVersion < 3) {
          const photos = db.createObjectStore("photos", { keyPath: "id" });
          photos.createIndex("by-pack", "packId");
          photos.createIndex("by-waypoint", "waypointId");
        }
      },
      // This tab is the one holding an older version open somewhere else. Let go,
      // or the other tab is the one that hangs.
      blocking() {
        const live = liveDb;
        const pending = openAttempt;
        forgetSafetyDb();
        if (live) {
          live.close();
          return;
        }
        // `blocking` can land in the microtasks between openDB resolving and the
        // assignment below, so close whatever the open produces instead.
        void pending?.then((db) => db.close(), () => {});
      },
      terminated() {
        forgetSafetyDb();
      },
    });
    // Attach the handler now, so a rejection can never surface as an unhandled
    // one, and drop the attempt so a later call opens a fresh connection.
    openAttempt.catch(() => {
      openAttempt = null;
    });
  }

  const attempt = openAttempt;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const db = await Promise.race([
      attempt,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), DB_OPEN_TIMEOUT_MS);
      }),
    ]);
    if (!db) {
      // Still blocked. Keep `openAttempt` so a retry re-awaits the same pending
      // open rather than stacking a second connection on top of it.
      dbPromise = null;
      return null;
    }
    liveDb = db;
    return db;
  } catch {
    forgetSafetyDb();
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function getDb() {
  return getSafetyDb();
}

/** Exposed for tests: drop the cached connection so the next call re-opens. */
export function __resetSafetyDbForTest() {
  // Some storage-failure tests intentionally provide a minimal database stub.
  if (typeof liveDb?.close === "function") liveDb.close();
  forgetSafetyDb();
}

const EMPTY_PROFILE: IceProfile = {
  name: "",
  iceName: "",
  icePhone: "",
  medical: "",
  partySize: 1,
};

export async function getIceProfile(): Promise<IceProfile> {
  const db = await getDb();
  if (!db) return EMPTY_PROFILE;
  return (await db.get("profile", "me")) ?? EMPTY_PROFILE;
}

/**
 * Returns false if the profile did not reach storage.
 *
 * This used to be fire-and-forget: the caller does `void saveIceProfile(next)`, so a
 * quota error or an aborted transaction became an unhandled rejection and the hiker
 * kept looking at their ICE contact sitting in React state, gone on next launch. The
 * phone most likely to be out of quota is the one that has been caching map tiles all
 * week, which is the same phone this is meant to protect.
 */
export async function saveIceProfile(profile: IceProfile): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  try {
    await db.put("profile", { ...profile, id: "me" });
    return true;
  } catch {
    return false;
  }
}

function waypointMatches(a: SafetyWaypoint | undefined, b: SafetyWaypoint): boolean {
  return Boolean(
    a &&
      a.id === b.id &&
      a.packId === b.packId &&
      a.kind === b.kind &&
      a.lat === b.lat &&
      a.lng === b.lng &&
      a.note === b.note &&
      a.recordedAt === b.recordedAt &&
      a.accuracyM === b.accuracyM &&
      a.positionSource === b.positionSource &&
      a.positionRecordedAt === b.positionRecordedAt,
  );
}

async function blobBytesMatch(a: Blob, b: Blob): Promise<boolean> {
  if (a.type !== b.type || a.size !== b.size) return false;
  const [left, right] = await Promise.all([a.arrayBuffer(), b.arrayBuffer()]);
  const leftBytes = new Uint8Array(left);
  const rightBytes = new Uint8Array(right);
  for (let index = 0; index < leftBytes.length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return false;
  }
  return true;
}

async function fieldPhotoMatches(a: FieldPhoto | undefined, b: FieldPhoto): Promise<boolean> {
  return Boolean(
    a &&
      a.id === b.id &&
      a.packId === b.packId &&
      a.waypointId === b.waypointId &&
      a.capturedAt === b.capturedAt &&
      a.mediaType === b.mediaType &&
      a.width === b.width &&
      a.height === b.height &&
      a.size === b.size &&
      await blobBytesMatch(a.blob, b.blob),
  );
}

function validWaypointPosition(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

/**
 * Writes a waypoint and then reads the exact record back before reporting success.
 * A React state update is never treated as proof that the mark survived a restart.
 */
export async function saveWaypoint(
  packId: string,
  kind: SafetyWaypoint["kind"],
  lat: number,
  lng: number,
  note?: string,
  position?: { accuracyM?: number; source?: PositionSource; recordedAt?: number },
): Promise<WaypointWriteResult> {
  if (!packId || !validWaypointPosition(lat, lng)) {
    return { ok: false, message: "This place has no usable GPS position, so it was not saved." };
  }
  const normalizedNote = note?.trim() || undefined;
  if (normalizedNote && Array.from(normalizedNote).length > 240) {
    return { ok: false, message: "Keep the place note to 240 characters or fewer." };
  }
  const positionDate =
    position?.recordedAt != null && Number.isFinite(position.recordedAt)
      ? new Date(position.recordedAt)
      : null;
  const point: SafetyWaypoint = {
    id: crypto.randomUUID(),
    packId,
    kind,
    lat,
    lng,
    note: normalizedNote,
    recordedAt: new Date().toISOString(),
    accuracyM:
      position?.accuracyM != null && Number.isFinite(position.accuracyM) && position.accuracyM >= 0
        ? position.accuracyM
        : undefined,
    positionSource: position?.source,
    positionRecordedAt:
      positionDate && Number.isFinite(positionDate.getTime())
        ? positionDate.toISOString()
        : undefined,
  };
  const db = await getDb();
  if (!db) {
    return { ok: false, message: "Storage is unavailable on this phone. This place was not saved." };
  }
  try {
    await db.put("waypoints", point);
    const stored = await db.get("waypoints", point.id);
    if (!waypointMatches(stored, point)) {
      return { ok: false, message: "The phone could not verify this saved place. Try again before moving on." };
    }
    return { ok: true, waypoint: stored! };
  } catch {
    return { ok: false, message: "The phone could not save this place. Free some storage and try again." };
  }
}

/** Compatibility wrapper for advanced tools. It rejects instead of claiming a memory-only save. */
export async function dropWaypoint(
  packId: string,
  kind: SafetyWaypoint["kind"],
  lat: number,
  lng: number,
  note?: string,
  position?: { accuracyM?: number; source?: PositionSource; recordedAt?: number },
): Promise<SafetyWaypoint> {
  const result = await saveWaypoint(packId, kind, lat, lng, note, position);
  if (!result.ok) throw new Error(result.message);
  return result.waypoint;
}

export async function listWaypoints(packId: string): Promise<SafetyWaypoint[]> {
  const db = await getDb();
  if (!db) return [];
  try {
    return (await db.getAllFromIndex("waypoints", "by-pack", packId)).sort((a, b) =>
      b.recordedAt.localeCompare(a.recordedAt),
    );
  } catch {
    return [];
  }
}

export async function readWaypoints(packId: string): Promise<WaypointReadResult> {
  const db = await getDb();
  if (!db) return { ok: false, message: "Saved places are unavailable on this phone." };
  try {
    const waypoints = (await db.getAllFromIndex("waypoints", "by-pack", packId)).sort((a, b) =>
      b.recordedAt.localeCompare(a.recordedAt),
    );
    return { ok: true, waypoints };
  } catch {
    return { ok: false, message: "The phone could not read your saved places." };
  }
}

export async function updateWaypoint(
  packId: string,
  id: string,
  update: Pick<SafetyWaypoint, "kind"> & { note?: string },
): Promise<WaypointWriteResult> {
  const db = await getDb();
  if (!db) return { ok: false, message: "Storage is unavailable. Changes were not saved." };
  const normalizedNote = update.note?.trim() || undefined;
  if (normalizedNote && Array.from(normalizedNote).length > 240) {
    return { ok: false, message: "Keep the place note to 240 characters or fewer." };
  }
  try {
    const current = await db.get("waypoints", id);
    if (!current || current.packId !== packId) {
      return { ok: false, message: "That saved place is no longer on this route." };
    }
    const next: SafetyWaypoint = {
      ...current,
      kind: update.kind,
      note: normalizedNote,
    };
    await db.put("waypoints", next);
    const stored = await db.get("waypoints", id);
    if (!waypointMatches(stored, next)) {
      return { ok: false, message: "The phone could not verify those changes. Reload before editing again." };
    }
    return { ok: true, waypoint: stored! };
  } catch {
    return { ok: false, message: "The phone could not save those changes." };
  }
}

export async function deleteWaypoint(packId: string, id: string): Promise<WaypointDeleteResult> {
  const db = await getDb();
  if (!db) return { ok: false, message: "Storage is unavailable. The place was not deleted." };
  try {
    const tx = db.transaction(["waypoints", "photos"], "readwrite");
    const point = await tx.objectStore("waypoints").get(id);
    if (!point || point.packId !== packId) {
      await tx.done;
      return { ok: false, message: "That saved place is no longer on this route." };
    }
    const photos = await tx.objectStore("photos").index("by-waypoint").getAll(id);
    await tx.objectStore("waypoints").delete(id);
    for (const photo of photos) await tx.objectStore("photos").delete(photo.id);
    await tx.done;
    const [storedPoint, storedPhotos] = await Promise.all([
      db.get("waypoints", id),
      db.getAllFromIndex("photos", "by-waypoint", id),
    ]);
    if (storedPoint || storedPhotos.length > 0) {
      return { ok: false, message: "The phone could not verify the deletion. Reload to check this place." };
    }
    return { ok: true, waypoint: point, photos };
  } catch {
    return { ok: false, message: "The phone could not delete this place." };
  }
}

export async function restoreWaypoint(
  waypoint: SafetyWaypoint,
  photos: FieldPhoto[] = [],
): Promise<WaypointWriteResult> {
  const db = await getDb();
  if (!db) return { ok: false, message: "Storage is unavailable. The place was not restored." };
  try {
    const tx = db.transaction(["waypoints", "photos"], "readwrite");
    await tx.objectStore("waypoints").put(waypoint);
    for (const photo of photos) await tx.objectStore("photos").put(photo);
    await tx.done;
    const stored = await db.get("waypoints", waypoint.id);
    const storedPhotos = await db.getAllFromIndex("photos", "by-waypoint", waypoint.id);
    const photosById = new Map(storedPhotos.map((photo) => [photo.id, photo]));
    const photosMatch = storedPhotos.length === photos.length && (
      await Promise.all(photos.map((photo) => fieldPhotoMatches(photosById.get(photo.id), photo)))
    ).every(Boolean);
    if (!waypointMatches(stored, waypoint) || !photosMatch) {
      return { ok: false, message: "The phone could not verify the restored place." };
    }
    return { ok: true, waypoint: stored! };
  } catch {
    return { ok: false, message: "The phone could not restore this place." };
  }
}

const MAX_FIELD_PHOTOS_PER_PACK = 30;
const MAX_FIELD_PHOTO_BYTES_PER_PACK = 20 * 1024 * 1024;
const MAX_FIELD_PHOTO_BYTES = 2 * 1024 * 1024;
const MAX_FIELD_PHOTO_EDGE = 1_600;

export async function saveFieldPhoto(
  photo: Omit<FieldPhoto, "id" | "capturedAt" | "size" | "mediaType"> & { blob: Blob },
): Promise<PhotoWriteResult> {
  if (
    !photo.packId ||
    !photo.waypointId ||
    photo.width < 1 ||
    photo.height < 1 ||
    !Number.isInteger(photo.width) ||
    !Number.isInteger(photo.height) ||
    photo.width > MAX_FIELD_PHOTO_EDGE ||
    photo.height > MAX_FIELD_PHOTO_EDGE ||
    photo.blob.type !== "image/jpeg" ||
    photo.blob.size < 1 ||
    photo.blob.size > MAX_FIELD_PHOTO_BYTES
  ) {
    return { ok: false, message: "That photo could not be prepared safely, so it was not saved." };
  }
  const db = await getDb();
  if (!db) return { ok: false, message: "Storage is unavailable. The photo was not saved." };
  try {
    // The ownership check, quota calculation and insert share one read/write
    // transaction so two simultaneous camera actions cannot both pass the same
    // stale quota read.
    const tx = db.transaction(["waypoints", "photos"], "readwrite");
    const waypoint = await tx.objectStore("waypoints").get(photo.waypointId);
    if (!waypoint || waypoint.packId !== photo.packId) {
      await tx.done;
      return { ok: false, message: "Save the place before attaching a photo." };
    }
    const photoStore = tx.objectStore("photos");
    const existing = await photoStore.index("by-pack").getAll(photo.packId);
    if (existing.length >= MAX_FIELD_PHOTOS_PER_PACK) {
      await tx.done;
      return { ok: false, message: `This route already has ${MAX_FIELD_PHOTOS_PER_PACK} photos. Delete one before adding another.` };
    }
    const used = existing.reduce((sum, item) => sum + item.size, 0);
    if (used + photo.blob.size > MAX_FIELD_PHOTO_BYTES_PER_PACK) {
      await tx.done;
      return { ok: false, message: "Route photos reached the 20 MB offline limit. Delete a photo and try again." };
    }
    const record: FieldPhoto = {
      ...photo,
      id: crypto.randomUUID(),
      capturedAt: new Date().toISOString(),
      mediaType: "image/jpeg",
      size: photo.blob.size,
    };
    await photoStore.put(record);
    await tx.done;
    const stored = await db.get("photos", record.id);
    if (!stored || !(await fieldPhotoMatches(stored, record))) {
      return { ok: false, message: "The phone could not verify the saved photo." };
    }
    return { ok: true, photo: stored };
  } catch {
    return { ok: false, message: "The phone could not save the photo. Free some storage and try again." };
  }
}

export async function readFieldPhotos(packId: string): Promise<PhotoReadResult> {
  const db = await getDb();
  if (!db) return { ok: false, message: "Saved photos are unavailable on this phone." };
  try {
    const photos = (await db.getAllFromIndex("photos", "by-pack", packId)).sort((a, b) =>
      b.capturedAt.localeCompare(a.capturedAt),
    );
    return { ok: true, photos };
  } catch {
    return { ok: false, message: "The phone could not read your saved photos." };
  }
}

export async function deleteFieldPhoto(packId: string, id: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  try {
    const photo = await db.get("photos", id);
    if (!photo || photo.packId !== packId) return false;
    await db.delete("photos", id);
    return (await db.get("photos", id)) == null;
  } catch {
    return false;
  }
}

export interface ResolvedLocalTime {
  instant: Date;
  resolvedLocal: string;
  timeZone: string;
  utcOffset: string;
}

export type LocalTimeResolution =
  | { kind: "invalid"; message: string }
  | { kind: "nonexistent"; message: string }
  | { kind: "ambiguous"; message: string; choices: [ResolvedLocalTime, ResolvedLocalTime] }
  | { kind: "resolved"; value: ResolvedLocalTime };

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function parseLocalParts(value: string): LocalParts | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (
    date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day || date.getUTCHours() !== hour || date.getUTCMinutes() !== minute
  ) return null;
  return { year, month, day, hour, minute };
}

function formatInTimeZone(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "shortOffset",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    local: `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`,
    offset: parts.timeZoneName ?? "UTC",
  };
}

/**
 * Resolves a datetime-local string in an IANA zone without relying on the
 * host Date parser. DST gaps are rejected; repeated wall times require an
 * explicit earlier/later selection.
 */
export function resolveLocalDateTime(
  value: string,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
  occurrence: "earlier" | "later" | null = null,
): LocalTimeResolution {
  const wanted = parseLocalParts(value);
  if (!wanted || !timeZone) return { kind: "invalid", message: "Enter a valid local date and time." };
  try {
    const nominal = Date.UTC(wanted.year, wanted.month - 1, wanted.day, wanted.hour, wanted.minute);
    const matches: Date[] = [];
    for (let millis = nominal - 15 * 3_600_000; millis <= nominal + 15 * 3_600_000; millis += 60_000) {
      const instant = new Date(millis);
      if (formatInTimeZone(instant, timeZone).local === value) matches.push(instant);
    }
    if (matches.length === 0) {
      return { kind: "nonexistent", message: "That local time does not exist because clocks change. Choose a real time." };
    }
    const choices = matches.map((instant) => {
      const formatted = formatInTimeZone(instant, timeZone);
      return {
        instant,
        resolvedLocal: formatted.local,
        timeZone,
        utcOffset: formatted.offset,
      };
    });
    if (choices.length > 1 && occurrence == null) {
      return {
        kind: "ambiguous",
        message: "That local time occurs twice because clocks change. Choose the first or second occurrence.",
        choices: [choices[0], choices[1]!],
      };
    }
    const choice = choices[occurrence === "later" ? choices.length - 1 : 0];
    if (!choice) return { kind: "invalid", message: "Unable to resolve that local time." };
    return { kind: "resolved", value: choice };
  } catch {
    return { kind: "invalid", message: "This device cannot resolve that time zone. Choose another time." };
  }
}

/**
 * Returns false if the deadline did not reach storage.
 *
 * The panel printed "Deadline: ..." before awaiting this, so a failed write left an
 * overdue alarm that looked armed and did nothing — the same failure `overdueStatus`
 * was hardened against from the other direction.
 */
export async function setOverdueAlarm(returnTime: ResolvedLocalTime | null): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  try {
    if (!returnTime) {
      await db.delete("overdue", "current");
      // Best-effort, after the store succeeded: the native locked-screen alarm
      // must track the stored deadline (web: no-op "unsupported").
      void syncOverdueNotification(null);
      return true;
    }
    await db.put("overdue", {
      id: "current",
      returnAt: returnTime.instant.toISOString(),
      resolvedLocal: returnTime.resolvedLocal,
      timeZone: returnTime.timeZone,
      utcOffset: returnTime.utcOffset,
    });
    void syncOverdueNotification(returnTime.instant.toISOString());
    return true;
  } catch {
    return false;
  }
}

export async function getOverdueAlarm(): Promise<OverdueAlarm | null> {
  const db = await getDb();
  if (!db) return null;
  const row = await db.get("overdue", "current");
  return row
    ? {
      returnAt: row.returnAt,
      resolvedLocal: row.resolvedLocal,
      timeZone: row.timeZone,
      utcOffset: row.utcOffset,
    }
    : null;
}

/**
 * An invalid stored value used to fall through to `NaN <= 0 === false`, which
 * silently disabled the overdue alarm and rendered "Return in NaN min" — the
 * alarm looked armed while doing nothing.
 *
 * `valid` exists because `overdue` alone cannot express "I do not know". A
 * corrupt deadline must not read as overdue (a false SOS prompt) and must not
 * read as safe either: callers that only render on `overdue` showed nothing at
 * all, so a hiker who set a return time was silently unmonitored. Callers must
 * surface `label` whenever `!valid`.
 */
export function overdueStatus(returnAt: string, now = Date.now()) {
  const deadline = Date.parse(returnAt);
  if (!Number.isFinite(deadline) || !Number.isFinite(now)) {
    // Fails closed as OVERDUE, deliberately. The alternative -- reporting
    // "unknown" with overdue: false -- reads as safe to every caller that
    // renders only on `overdue`, so a hiker whose stored deadline had been
    // corrupted was silently unmonitored while believing the alarm was armed.
    // A visible false alarm is recoverable; silence is not. The label says
    // "invalid" rather than "OVERDUE by N", so the user is told what to fix.
    return {
      valid: false,
      overdue: true,
      remainingMin: null,
      label: "Return time invalid — set a real local time so the overdue alarm can arm.",
    };
  }
  const remainingMin = Math.round((deadline - now) / 60000);
  if (remainingMin <= 0) {
    return {
      valid: true,
      overdue: true,
      remainingMin,
      label: `OVERDUE by ${formatElapsed(Math.abs(remainingMin))} — check in or send SOS`,
    };
  }
  return {
    valid: true,
    overdue: false,
    remainingMin,
    label: `Return in ${formatElapsed(remainingMin)}`,
  };
}

/**
 * Human-readable duration for a return-time deadline.
 *
 * A raw minute count is unusable at scale: a device clock stuck at the epoch
 * produced "OVERDUE by 29787396 min", which tells a worried contact nothing.
 * Degrade to coarser units and cap the display, since past a few days the exact
 * figure carries no operational meaning and usually indicates a bad clock.
 */
export function formatElapsed(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return "an unknown amount of time";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rem = minutes % 60;
    return rem ? `${hours} h ${rem} min` : `${hours} h`;
  }
  const days = Math.floor(hours / 24);
  if (days < 14) {
    const rem = hours % 24;
    return rem ? `${days} d ${rem} h` : `${days} d`;
  }
  return "more than 2 weeks (check the device clock)";
}
