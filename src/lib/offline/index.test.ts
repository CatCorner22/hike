import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getOfflineDb, getPendingPointCount, resetOfflineDbForTests } from "./index";

const DB_NAME = "hike-offline";

function deleteDatabase() {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function createV1BooleanPoint() {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const points = request.result.createObjectStore("pendingPoints", { keyPath: "id" });
      points.createIndex("by-activity", "activityId");
      points.createIndex("by-synced", "synced");
      request.result.createObjectStore("offlineTrails", { keyPath: "id" });
      request.result.createObjectStore("offlinePlans", { keyPath: "id" });
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("pendingPoints", "readwrite");
      tx.objectStore("pendingPoints").put({ id: "legacy", activityId: "activity", lat: 1, lng: 2, recordedAt: new Date().toISOString(), synced: false });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  });
}

beforeEach(async () => {
  vi.stubGlobal("window", globalThis);
  await resetOfflineDbForTests();
  await deleteDatabase();
});
afterEach(async () => { await resetOfflineDbForTests(); vi.unstubAllGlobals(); });

describe("pendingPoints v1 migration", () => {
  it("converts boolean synced values to numeric index values", async () => {
    await createV1BooleanPoint();
    const db = await getOfflineDb();
    expect(db?.version).toBe(2);
    expect(await getPendingPointCount()).toBe(1);
    const point = await db?.get("pendingPoints", "legacy");
    expect(point?.synced).toBe(0);
  });
});
