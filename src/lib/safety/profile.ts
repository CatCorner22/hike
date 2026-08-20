import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export interface IceProfile {
  name: string;
  iceName: string;
  icePhone: string;
  medical: string;
  partySize: number;
  bloodType?: string;
  challenge?: string;
  password?: string;
}

export interface SafetyWaypoint {
  id: string;
  packId: string;
  kind: "water" | "junction" | "camp" | "note" | "lkp" | "rp" | "orp" | "ap" | "cf" | "hr";
  lat: number;
  lng: number;
  note?: string;
  recordedAt: string;
}

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
}

interface SafetyDB extends DBSchema {
  profile: { key: string; value: IceProfile & { id: string } };
  waypoints: { key: string; value: SafetyWaypoint; indexes: { "by-pack": string } };
  overdue: { key: string; value: OverdueAlarm & { id: string } };
  checkins: { key: string; value: CheckinEntry; indexes: { "by-pack": string } };
  checkinSettings: { key: string; value: CheckinSettings & { id: string } };
}

let dbPromise: Promise<IDBPDatabase<SafetyDB>> | null = null;

export function getSafetyDb() {
  if (typeof indexedDB === "undefined") return null;
  if (!dbPromise) {
    dbPromise = openDB<SafetyDB>("hike-safety", 2, {
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
      },
    });
  }
  return dbPromise;
}

function getDb() {
  return getSafetyDb();
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

export async function saveIceProfile(profile: IceProfile) {
  const db = await getDb();
  if (!db) return;
  await db.put("profile", { ...profile, id: "me" });
}

export async function dropWaypoint(
  packId: string,
  kind: SafetyWaypoint["kind"],
  lat: number,
  lng: number,
  note?: string,
): Promise<SafetyWaypoint> {
  const point: SafetyWaypoint = {
    id: crypto.randomUUID(),
    packId,
    kind,
    lat,
    lng,
    note,
    recordedAt: new Date().toISOString(),
  };
  const db = await getDb();
  if (db) await db.put("waypoints", point);
  return point;
}

export async function listWaypoints(packId: string): Promise<SafetyWaypoint[]> {
  const db = await getDb();
  if (!db) return [];
  return db.getAllFromIndex("waypoints", "by-pack", packId);
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

export async function setOverdueAlarm(returnTime: ResolvedLocalTime | null) {
  const db = await getDb();
  if (!db) return;
  if (!returnTime) {
    await db.delete("overdue", "current");
    return;
  }
  await db.put("overdue", {
    id: "current",
    returnAt: returnTime.instant.toISOString(),
    resolvedLocal: returnTime.resolvedLocal,
    timeZone: returnTime.timeZone,
    utcOffset: returnTime.utcOffset,
  });
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
 * Returns null for an unparseable time. An invalid stored value used to fall through
 * to `NaN <= 0 === false`, which silently disabled the overdue alarm and rendered
 * "Return in NaN min" — the alarm looked armed while doing nothing.
 */
export function overdueStatus(returnAt: string, now = Date.now()) {
<<<<<<< HEAD
  const parsed = Date.parse(returnAt);
  if (!Number.isFinite(parsed)) {
    return {
      overdue: true,
      remainingMin: Number.NaN,
      label: "Return time is invalid — set it again or send SOS",
    };
  }
  const remainingMin = Math.round((parsed - now) / 60000);
=======
  const deadline = Date.parse(returnAt);
  if (!Number.isFinite(deadline) || !Number.isFinite(now)) {
    // Return a shaped result rather than null: callers render `label` directly,
    // and an unparseable stored deadline must read as "unknown", never as
    // "overdue" (which would trigger a false alarm) and never as safe.
    return {
      overdue: false,
      remainingMin: null,
      label: "Return time invalid — set a real local time.",
    };
  }
  const remainingMin = Math.round((deadline - now) / 60000);
>>>>>>> origin/main
  if (remainingMin <= 0) {
    return {
      overdue: true,
      remainingMin,
      label: `OVERDUE by ${formatElapsed(Math.abs(remainingMin))} — check in or send SOS`,
    };
  }
  return {
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
function formatElapsed(minutes: number): string {
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
