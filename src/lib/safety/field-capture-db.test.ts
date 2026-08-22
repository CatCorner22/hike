import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import {
  __resetSafetyDbForTest,
  deleteFieldPhoto,
  deleteWaypoint,
  readFieldPhotos,
  readWaypoints,
  restoreWaypoint,
  saveFieldPhoto,
  saveWaypoint,
  updateWaypoint,
} from "./profile";

describe("durable field capture", () => {
  beforeEach(() => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    __resetSafetyDbForTest();
  });

  afterEach(() => {
    __resetSafetyDbForTest();
    vi.unstubAllGlobals();
  });

  it("creates, reads, edits, deletes, and restores the exact waypoint", async () => {
    const created = await saveWaypoint("pack-1", "junction", 47.12345, -122.54321, "  left fork  ");
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await expect(readWaypoints("pack-1")).resolves.toEqual({
      ok: true,
      waypoints: [{ ...created.waypoint, note: "left fork" }],
    });

    const edited = await updateWaypoint("pack-1", created.waypoint.id, {
      kind: "water",
      note: "creek",
    });
    expect(edited).toEqual({
      ok: true,
      waypoint: { ...created.waypoint, kind: "water", note: "creek" },
    });

    const removed = await deleteWaypoint("pack-1", created.waypoint.id);
    expect(removed).toMatchObject({ ok: true, waypoint: { id: created.waypoint.id }, photos: [] });
    await expect(readWaypoints("pack-1")).resolves.toEqual({ ok: true, waypoints: [] });

    if (!removed.ok) return;
    await expect(restoreWaypoint(removed.waypoint, removed.photos)).resolves.toMatchObject({ ok: true });
    await expect(readWaypoints("pack-1")).resolves.toMatchObject({
      ok: true,
      waypoints: [{ id: created.waypoint.id, kind: "water", note: "creek" }],
    });
  });

  it("upgrades the existing v2 safety database without losing old waypoints", async () => {
    const legacyPoint = {
      id: "legacy-waypoint",
      packId: "pack-legacy",
      kind: "water" as const,
      lat: 44.1,
      lng: -110.7,
      note: "old spring",
      recordedAt: "2026-08-20T12:00:00.000Z",
    };
    const legacyDb = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("hike-safety", 2);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore("profile", { keyPath: "id" });
        const waypoints = db.createObjectStore("waypoints", { keyPath: "id" });
        waypoints.createIndex("by-pack", "packId");
        db.createObjectStore("overdue", { keyPath: "id" });
        const checkins = db.createObjectStore("checkins", { keyPath: "id" });
        checkins.createIndex("by-pack", "packId");
        db.createObjectStore("checkinSettings", { keyPath: "id" });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve, reject) => {
      const request = legacyDb.transaction("waypoints", "readwrite").objectStore("waypoints").put(legacyPoint);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
    legacyDb.close();
    __resetSafetyDbForTest();

    await expect(readWaypoints("pack-legacy")).resolves.toEqual({ ok: true, waypoints: [legacyPoint] });
    const added = await saveWaypoint("pack-legacy", "camp", 44.2, -110.8);
    expect(added.ok).toBe(true);
    await expect(readFieldPhotos("pack-legacy")).resolves.toEqual({ ok: true, photos: [] });
  });

  it("stores a bounded JPEG with its place and deletes or restores them together", async () => {
    const created = await saveWaypoint("pack-photos", "camp", 38.1, -109.5, "night one");
    if (!created.ok) throw new Error(created.message);
    const blob = new Blob(["private-jpeg"], { type: "image/jpeg" });
    const photo = await saveFieldPhoto({
      packId: "pack-photos",
      waypointId: created.waypoint.id,
      width: 800,
      height: 600,
      blob,
    });
    expect(photo).toMatchObject({ ok: true, photo: { size: blob.size, mediaType: "image/jpeg" } });
    await expect(readFieldPhotos("pack-photos")).resolves.toMatchObject({
      ok: true,
      photos: [{ waypointId: created.waypoint.id, size: blob.size }],
    });

    const removed = await deleteWaypoint("pack-photos", created.waypoint.id);
    expect(removed).toMatchObject({ ok: true, photos: [{ waypointId: created.waypoint.id }] });
    await expect(readFieldPhotos("pack-photos")).resolves.toEqual({ ok: true, photos: [] });

    if (!removed.ok) return;
    await expect(restoreWaypoint(removed.waypoint, removed.photos)).resolves.toMatchObject({ ok: true });
    await expect(readFieldPhotos("pack-photos")).resolves.toMatchObject({
      ok: true,
      photos: [{ waypointId: created.waypoint.id }],
    });
  });

  it("never reports a memory-only save when storage is unavailable", async () => {
    __resetSafetyDbForTest();
    vi.stubGlobal("indexedDB", undefined);
    await expect(saveWaypoint("pack-1", "note", 47, -122)).resolves.toEqual({
      ok: false,
      message: "Storage is unavailable on this phone. This place was not saved.",
    });
  });

  it("won't attach or delete a photo through the wrong route", async () => {
    const created = await saveWaypoint("pack-a", "note", 47, -122);
    if (!created.ok) throw new Error(created.message);
    const denied = await saveFieldPhoto({
      packId: "pack-b",
      waypointId: created.waypoint.id,
      width: 10,
      height: 10,
      blob: new Blob(["x"], { type: "image/jpeg" }),
    });
    expect(denied).toEqual({ ok: false, message: "Save the place before attaching a photo." });

    const allowed = await saveFieldPhoto({
      packId: "pack-a",
      waypointId: created.waypoint.id,
      width: 10,
      height: 10,
      blob: new Blob(["x"], { type: "image/jpeg" }),
    });
    if (!allowed.ok) throw new Error(allowed.message);
    await expect(deleteFieldPhoto("pack-b", allowed.photo.id)).resolves.toBe(false);
    await expect(readFieldPhotos("pack-a")).resolves.toMatchObject({ ok: true, photos: [{ id: allowed.photo.id }] });
  });

  it("enforces photo bounds again at the durable storage boundary", async () => {
    const created = await saveWaypoint("pack-a", "note", 47, -122);
    if (!created.ok) throw new Error(created.message);
    await expect(
      saveFieldPhoto({
        packId: "pack-a",
        waypointId: created.waypoint.id,
        width: 1_601,
        height: 900,
        blob: new Blob(["x"], { type: "image/jpeg" }),
      }),
    ).resolves.toEqual({
      ok: false,
      message: "That photo could not be prepared safely, so it was not saved.",
    });
  });

  it("serializes concurrent saves at the 30-photo route quota", async () => {
    const created = await saveWaypoint("pack-quota", "note", 47, -122);
    if (!created.ok) throw new Error(created.message);
    const input = () => ({
      packId: "pack-quota",
      waypointId: created.waypoint.id,
      width: 10,
      height: 10,
      blob: new Blob(["x"], { type: "image/jpeg" }),
    });
    for (let count = 0; count < 29; count += 1) {
      const saved = await saveFieldPhoto(input());
      expect(saved.ok).toBe(true);
    }

    const finalPair = await Promise.all([saveFieldPhoto(input()), saveFieldPhoto(input())]);
    expect(finalPair.filter((result) => result.ok)).toHaveLength(1);
    expect(finalPair.filter((result) => !result.ok)).toHaveLength(1);
    await expect(readFieldPhotos("pack-quota")).resolves.toMatchObject({
      ok: true,
      photos: expect.arrayContaining([expect.objectContaining({ packId: "pack-quota" })]),
    });
    const photos = await readFieldPhotos("pack-quota");
    expect(photos.ok && photos.photos).toHaveLength(30);
  });
});
