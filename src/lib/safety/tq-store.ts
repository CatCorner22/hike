import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export interface TourniquetRecord {
  appliedAt: string;
  limb: string;
}

interface TourniquetDB extends DBSchema {
  tourniquet: { key: string; value: TourniquetRecord & { id: string } };
}

let dbPromise: Promise<IDBPDatabase<TourniquetDB>> | null = null;

function getDb() {
  if (typeof indexedDB === "undefined") return null;
  if (!dbPromise) {
    dbPromise = openDB<TourniquetDB>("hike-tourniquet", 1, {
      upgrade(db) {
        db.createObjectStore("tourniquet", { keyPath: "id" });
      },
    });
  }
  return dbPromise;
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
