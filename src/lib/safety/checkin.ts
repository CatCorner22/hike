import type { CheckinEntry, CheckinSettings } from "@/lib/safety/profile";
import { formatElapsed, getSafetyDb } from "@/lib/safety/profile";
import { reportField } from "@/lib/safety/report-field";

export type { CheckinEntry, CheckinSettings } from "@/lib/safety/profile";

export const CHECKIN_INTERVALS = [30, 60, 90] as const;

const DEFAULT_SETTINGS: CheckinSettings = { intervalMin: 60, enabled: false };

/** A stored row survives schema drift and manual edits; a corrupt interval must not disarm the monitor. */
function normalizeIntervalMin(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_SETTINGS.intervalMin;
}

export async function getCheckinSettings(): Promise<CheckinSettings> {
  const db = await getSafetyDb();
  if (!db) return DEFAULT_SETTINGS;
  const row = await db.get("checkinSettings", "current");
  return row
    ? {
        intervalMin: normalizeIntervalMin(row.intervalMin),
        enabled: row.enabled,
        armedAt: row.enabled ? row.armedAt : undefined,
      }
    : DEFAULT_SETTINGS;
}

/** Small allowance for clock drift between devices; matches the repo's backtrack skew bound. */
const FUTURE_SKEW_ALLOWANCE_MS = 2 * 60_000;

export async function saveCheckinSettings(
  settings: CheckinSettings,
  now = Date.now(),
): Promise<boolean> {
  const db = await getSafetyDb();
  if (!db) return false;
  let next: CheckinSettings;
  if (settings.enabled) {
    // Arming marks the start of a monitoring session. On the disabled -> enabled
    // transition a caller-supplied armedAt is honored only when it is fresh: the
    // readiness gate stamps "now" and verifies its write byte-for-byte, so that value
    // must round-trip — but a pause/resume that replayed a stale armedAt re-armed the
    // monitor already overdue, prompting SOS the instant it was switched on. While
    // already enabled, updates (interval changes) keep the original arm time.
    let wasEnabled = false;
    try {
      wasEnabled = (await db.get("checkinSettings", "current"))?.enabled === true;
    } catch {
      /* treat unreadable state as a fresh arm */
    }
    const callerArmMs = settings.armedAt ? Date.parse(settings.armedAt) : Number.NaN;
    const callerArmIsFresh =
      Number.isFinite(callerArmMs) &&
      Math.abs(now - callerArmMs) <= FUTURE_SKEW_ALLOWANCE_MS;
    const armedAt =
      (wasEnabled || callerArmIsFresh ? settings.armedAt : undefined) ??
      new Date(now).toISOString();
    next = { intervalMin: normalizeIntervalMin(settings.intervalMin), enabled: true, armedAt };
  } else {
    next = { intervalMin: normalizeIntervalMin(settings.intervalMin), enabled: false };
  }
  try {
    await db.put("checkinSettings", { ...next, id: "current" });
    return true;
  } catch {
    return false;
  }
}

/**
 * The entry is returned for display either way; `saved` says whether it durably
 * landed. A refused write must surface as NOT SAVED — reporting success while
 * storing nothing told the hiker a check-in existed that no one could ever read.
 */
export async function logCheckin(
  packId: string,
  input: { lat?: number; lng?: number; note?: string } = {},
): Promise<{ entry: CheckinEntry; saved: boolean }> {
  const entry: CheckinEntry = {
    id: crypto.randomUUID(),
    packId,
    recordedAt: new Date().toISOString(),
    lat: input.lat,
    lng: input.lng,
    note: input.note,
  };
  const db = await getSafetyDb();
  if (!db) return { entry, saved: false };
  try {
    await db.put("checkins", entry);
    return { entry, saved: true };
  } catch {
    return { entry, saved: false };
  }
}

export async function listCheckins(packId: string, limit = 20): Promise<CheckinEntry[]> {
  const db = await getSafetyDb();
  if (!db) return [];
  const all = await db.getAllFromIndex("checkins", "by-pack", packId);
  return all.sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt)).slice(0, limit);
}

export async function lastCheckin(packId: string): Promise<CheckinEntry | null> {
  const rows = await listCheckins(packId, 1);
  return rows[0] ?? null;
}

export function checkinStatus(
  lastAt: string | null,
  settings: CheckinSettings,
  now = Date.now(),
): { overdue: boolean; label: string; dueInMin: number } | null {
  if (!settings.enabled) return null;
  const failClosed = {
    overdue: true,
    label: "Check-in time is invalid — tap I'm OK or send SOS",
    dueInMin: Number.NaN,
  };
  // An enabled monitor with a corrupt interval must alarm, not go silent: NaN slipped
  // past `<= 0`, poisoned the arithmetic, and every later branch returned null forever.
  if (!Number.isFinite(settings.intervalMin) || settings.intervalMin <= 0) return failClosed;

  // The schedule for THIS monitoring session starts when it is armed: an "I'm OK"
  // logged before arming belongs to a previous outing, so the reference is the LATER
  // of the last check-in and armedAt — a stale check-in must not make a freshly armed
  // monitor instantly overdue.
  const parsed: number[] = [];
  for (const value of [lastAt, settings.armedAt]) {
    if (value == null) continue;
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) return failClosed;
    parsed.push(ms);
  }
  if (parsed.length === 0) {
    return {
      overdue: false,
      label: `Check-in every ${settings.intervalMin} min — tap I'm OK when safe`,
      dueInMin: settings.intervalMin,
    };
  }
  const lastMs = Math.max(...parsed);
  // A reference later than now (past small skew) can never be legitimate. Waiting it
  // out delays the alarm by exactly the clock error — or forever.
  if (lastMs > now + FUTURE_SKEW_ALLOWANCE_MS) return failClosed;

  const elapsedMin = Math.round((now - lastMs) / 60000);
  const dueInMin = settings.intervalMin - elapsedMin;
  if (dueInMin <= 0) {
    return {
      overdue: true,
      label: `Check-in OVERDUE by ${formatElapsed(Math.abs(dueInMin))} — tap I'm OK or send SOS`,
      dueInMin,
    };
  }
  if (dueInMin <= 10) {
    return {
      overdue: false,
      label: `Check-in due in ${dueInMin} min`,
      dueInMin,
    };
  }
  return null;
}

export function formatCheckinLog(entries: CheckinEntry[]): string {
  if (entries.length === 0) return "No check-ins logged.";
  return entries
    .map((e) => {
      // One corrupt recordedAt used to throw RangeError out of toISOString and take
      // down the whole panel render and SAR dossier. A formatter never throws.
      const ms = Date.parse(e.recordedAt);
      const t = Number.isFinite(ms) ? new Date(ms).toISOString() : "time UNKNOWN";
      const grid =
        e.lat != null && e.lng != null && Number.isFinite(e.lat) && Number.isFinite(e.lng)
          ? ` @ ${e.lat.toFixed(5)}, ${e.lng.toFixed(5)}`
          : "";
      const note = e.note ? ` — ${reportField(e.note)}` : "";
      return `${t}${grid}${note}`;
    })
    .join("\n");
}
