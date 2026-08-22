import type { CheckinEntry, CheckinSettings } from "@/lib/safety/profile";
import { getSafetyDb } from "@/lib/safety/profile";

export type { CheckinEntry, CheckinSettings } from "@/lib/safety/profile";

export const CHECKIN_INTERVALS = [30, 60, 90] as const;

const DEFAULT_SETTINGS: CheckinSettings = { intervalMin: 60, enabled: false };

export async function getCheckinSettings(): Promise<CheckinSettings> {
  const db = await getSafetyDb();
  if (!db) return DEFAULT_SETTINGS;
  const row = await db.get("checkinSettings", "current");
  return row
    ? {
        intervalMin: row.intervalMin,
        enabled: row.enabled,
        armedAt: row.enabled ? row.armedAt : undefined,
      }
    : DEFAULT_SETTINGS;
}

export async function saveCheckinSettings(settings: CheckinSettings): Promise<boolean> {
  const db = await getSafetyDb();
  if (!db) return false;
  const next: CheckinSettings = settings.enabled
    ? { ...settings, armedAt: settings.armedAt ?? new Date().toISOString() }
    : { intervalMin: settings.intervalMin, enabled: false };
  try {
    await db.put("checkinSettings", { ...next, id: "current" });
    return true;
  } catch {
    return false;
  }
}

export async function logCheckin(
  packId: string,
  input: { lat?: number; lng?: number; note?: string } = {},
): Promise<CheckinEntry> {
  const entry: CheckinEntry = {
    id: crypto.randomUUID(),
    packId,
    recordedAt: new Date().toISOString(),
    lat: input.lat,
    lng: input.lng,
    note: input.note,
  };
  const db = await getSafetyDb();
  if (db) await db.put("checkins", entry);
  return entry;
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
  if (!settings.enabled || settings.intervalMin <= 0) return null;
  const reference = lastAt ?? settings.armedAt ?? null;
  if (!reference) {
    return {
      overdue: false,
      label: `Check-in every ${settings.intervalMin} min — tap I'm OK when safe`,
      dueInMin: settings.intervalMin,
    };
  }
  const lastMs = Date.parse(reference);
  if (!Number.isFinite(lastMs)) {
    return {
      overdue: true,
      label: "Check-in time is invalid — tap I'm OK or send SOS",
      dueInMin: Number.NaN,
    };
  }
  const elapsedMin = Math.round((now - lastMs) / 60000);
  const dueInMin = settings.intervalMin - elapsedMin;
  if (dueInMin <= 0) {
    return {
      overdue: true,
      label: `Check-in OVERDUE by ${Math.abs(dueInMin)} min — tap I'm OK or send SOS`,
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
      const t = new Date(e.recordedAt).toISOString();
      const grid =
        e.lat != null && e.lng != null ? ` @ ${e.lat.toFixed(5)}, ${e.lng.toFixed(5)}` : "";
      const note = e.note ? ` — ${e.note}` : "";
      return `${t}${grid}${note}`;
    })
    .join("\n");
}
