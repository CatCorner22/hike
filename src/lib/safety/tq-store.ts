import type { DBSchema } from "idb";
import { createIdbOpener } from "@/lib/offline/idb-open";

export interface TourniquetRecord {
  appliedAt: string;
  limb: string;
}

interface TourniquetDB extends DBSchema {
  tourniquet: { key: string; value: TourniquetRecord & { id: string } };
}

// The tourniquet clock of all things must not be disabled for the session by
// one transient IndexedDB failure; the opener retries and survives blocked
// upgrades and terminated connections.
const tourniquetDb = createIdbOpener<TourniquetDB>("hike-tourniquet", 1, {
  upgrade(db) {
    db.createObjectStore("tourniquet", { keyPath: "id" });
  },
});

function getDb() {
  return tourniquetDb.getDb();
}

export async function getTourniquetRecord(): Promise<TourniquetRecord | null> {
  const db = await getDb();
  if (!db) return null;
  const row = await db.get("tourniquet", "current");
  return row ? { appliedAt: row.appliedAt, limb: row.limb } : null;
}

export async function setTourniquetRecord(record: TourniquetRecord) {
  const db = await getDb();
  if (!db) return;
  await db.put("tourniquet", { ...record, id: "current" });
}

export async function clearTourniquetRecord() {
  const db = await getDb();
  if (!db) return;
  await db.delete("tourniquet", "current");
}
