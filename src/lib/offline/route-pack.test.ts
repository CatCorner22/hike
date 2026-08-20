import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ROUTE_PACK_VERSION,
  buildRoutePack,
  getRoutePack,
  getRoutePackStatus,
  listRoutePacks,
  resetRoutePackDbForTests,
  saveRoutePack,
  validateRoutePack,
} from "./route-pack";

const DB_NAME = "hike-nav-packs";
const geometry: GeoJSON.LineString = {
  type: "LineString",
  coordinates: [
    [-119.5383, 37.7749],
    [-119.5379, 37.7751],
  ],
};

function deleteDatabase() {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function recordCount() {
  return new Promise<number>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("routePacks", "readonly");
      const all = tx.objectStore("routePacks").getAll();
      all.onsuccess = () => {
        resolve(all.result.length);
        db.close();
      };
      all.onerror = () => reject(all.error);
    };
  });
}

async function createLegacyDatabase(records: unknown[]) {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const db = request.result;
      const packs = db.createObjectStore("routePacks", { keyPath: "id" });
      packs.createIndex("by-alias", "aliases", { multiEntry: true });
      db.createObjectStore("lastFix", { keyPath: "id" });
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("routePacks", "readwrite");
      records.forEach((record) => tx.objectStore("routePacks").put(record));
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
  });
}

beforeEach(async () => {
  await resetRoutePackDbForTests();
  await deleteDatabase();
});

afterEach(async () => {
  await resetRoutePackDbForTests();
});

describe("route pack aliases and migration", () => {
  it("resolves every alias to one canonical stored payload", async () => {
    const pack = buildRoutePack({
      id: "plan-123",
      aliases: ["123", "trail-456", "456"],
      name: "Alias route",
      geometry,
    });

    await saveRoutePack(pack);

    await expect(getRoutePack("123")).resolves.toMatchObject({ id: "plan-123" });
    await expect(getRoutePack("trail-456")).resolves.toMatchObject({ id: "plan-123" });
    expect(await recordCount()).toBe(1);
  });

  it("does not create duplicate payloads when saving aliases", async () => {
    await saveRoutePack(
      buildRoutePack({
        id: "plan-123",
        aliases: ["123", "trail-456"],
        name: "Single payload",
        geometry,
      }),
    );

    expect(await recordCount()).toBe(1);
    expect(await listRoutePacks()).toHaveLength(1);
  });

  it("migrates v1 duplicate alias records without losing the pack", async () => {
    const canonical = {
      ...buildRoutePack({
        id: "plan-123",
        aliases: ["123", "trail-456"],
        name: "Migrated route",
        geometry,
      }),
      version: 2,
    };
    await createLegacyDatabase([
      canonical,
      { ...canonical, id: "123" },
      { ...canonical, id: "trail-456" },
    ]);

    await resetRoutePackDbForTests();
    expect(await listRoutePacks()).toHaveLength(1);
    expect(await recordCount()).toBe(1);
    expect(await getRoutePackStatus("trail-456")).toMatchObject({
      status: "stale",
      pack: { id: "plan-123" },
    });
  });

  it("reports an older payload version as stale instead of loading it", async () => {
    const stale = {
      ...buildRoutePack({
        id: "plan-stale",
        name: "Stale route",
        geometry,
      }),
      version: ROUTE_PACK_VERSION - 1,
    };
    await createLegacyDatabase([stale]);
    await resetRoutePackDbForTests();

    await expect(getRoutePack("plan-stale")).resolves.toBeNull();
    await expect(getRoutePackStatus("plan-stale")).resolves.toMatchObject({
      status: "stale",
    });
  });
});

describe("route pack integrity boundaries", () => {
  it("rejects an alias pointer whose payload does not claim the requested id", async () => {
    const pack = buildRoutePack({ id: "evil-canonical", aliases: ["unrelated"], name: "Wrong trail", geometry });
    // Initialize the v4 schema before simulating an attacker-controlled record.
    await saveRoutePack(buildRoutePack({ id: "seed", name: "Seed", geometry }));
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 4);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(["routePacks", "aliases"], "readwrite");
        tx.objectStore("routePacks").put(pack);
        tx.objectStore("aliases").put({ alias: "plan-victim", canonicalId: "evil-canonical" });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });
    await resetRoutePackDbForTests();
    await expect(getRoutePack("plan-victim")).resolves.toBeNull();
    await expect(getRoutePackStatus("plan-victim")).resolves.toMatchObject({
      status: "invalid",
      error: "Saved route does not match this trail — re-download while you have signal.",
    });
  });

  it("rejects unbounded or malformed safety metadata", () => {
    const pack = buildRoutePack({ id: "plan-safe", name: "Safe route", geometry });
    expect(validateRoutePack({
      ...pack,
      elevationProfile: [{ distanceMeters: 2, elevation: 1 }, { distanceMeters: 2, elevation: 2 }],
    })).toContain("elevation");
    expect(validateRoutePack({ ...pack, gpx: "x".repeat(3 * 1024 * 1024) })).toContain("too large");
  });

  it("aborts the payload transaction when an alias write throws synchronously", async () => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function patchedPut(this: IDBObjectStore, value: unknown) {
      if (this.name === "aliases") throw new DOMException("synthetic alias failure", "QuotaExceededError");
      return original.call(this, value);
    };
    try {
      await expect(saveRoutePack(buildRoutePack({ id: "plan-atomic", name: "Atomic", geometry }))).rejects.toThrow("synthetic alias failure");
    } finally {
      IDBObjectStore.prototype.put = original;
    }
    expect(await recordCount()).toBe(0);
  });
});
