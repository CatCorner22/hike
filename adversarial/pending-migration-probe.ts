/** Run: npx tsx adversarial/pending-migration-probe.ts */
import "fake-indexeddb/auto";

function request<T>(r: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}
function transactionDone(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
}

async function main() {
  (globalThis as { window?: unknown }).window = globalThis;
  const opened = indexedDB.open("hike-offline", 1);
  opened.onupgradeneeded = () => {
    const db = opened.result;
    const points = db.createObjectStore("pendingPoints", { keyPath: "id" });
    points.createIndex("by-activity", "activityId");
    db.createObjectStore("offlineTrails", { keyPath: "id" });
    db.createObjectStore("offlinePlans", { keyPath: "id" });
  };
  const legacy = await request(opened);
  const tx = legacy.transaction("pendingPoints", "readwrite");
  tx.objectStore("pendingPoints").put({ id: "legacy-bool", activityId: "a", lat: 1, lng: 2, recordedAt: new Date().toISOString(), synced: false });
  await transactionDone(tx);
  legacy.close();

  const { getOfflineDb } = await import("../src/lib/offline/index");
  const db = await getOfflineDb();
  const value = await db!.get("pendingPoints", "legacy-bool");
  const count = await db!.countFromIndex("pendingPoints", "by-synced", 0);
  console.log(JSON.stringify({ version: db!.version, value, unsyncedIndexCount: count }, null, 2));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
