import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  flushPendingPoints,
  getPendingPointCount,
  getOfflineDb,
  MAX_PENDING_POINT_COUNT,
  OfflinePointQueueFullError,
  queueActivityPoint,
  __resetOfflineDbForTests,
} from "./index";

const ACTIVITY = "11111111-1111-4111-8111-111111111111";

async function queue(count: number, activityId = ACTIVITY) {
  for (let index = 0; index < count; index += 1) {
    await queueActivityPoint({
      activityId,
      lat: 37.7 + index / 10_000,
      lng: -119.6,
      recordedAt: new Date(1_700_000_000_000 + index * 1000),
    });
  }
}

function respondWith(status: number) {
  return vi.fn(async () => new Response(status === 200 ? "{}" : "", { status }));
}

beforeEach(async () => {
  await __resetOfflineDbForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("point sync failure handling", () => {
  it("rejects a point at the recording budget instead of consuming route-pack capacity", async () => {
    await queue(MAX_PENDING_POINT_COUNT);

    await expect(queueActivityPoint({
      activityId: ACTIVITY,
      lat: 38,
      lng: -120,
      recordedAt: new Date(),
    })).rejects.toMatchObject({
      name: "OfflinePointQueueFullError",
      message: expect.stringContaining("GPS point was not saved"),
    });
    expect(await getPendingPointCount()).toBe(MAX_PENDING_POINT_COUNT);
  });

  it("surfaces an IndexedDB quota failure as a recorder-safe error", async () => {
    const db = await getOfflineDb();
    if (!db) throw new Error("fake IndexedDB unavailable");
    const quota = new DOMException("probe full", "QuotaExceededError");
    const put = vi.spyOn(db, "put").mockRejectedValueOnce(quota);

    await expect(queueActivityPoint({
      activityId: ACTIVITY,
      lat: 37,
      lng: -119,
      recordedAt: new Date(),
    })).rejects.toBeInstanceOf(OfflinePointQueueFullError);
    put.mockRestore();
    await expect(queueActivityPoint({
      activityId: ACTIVITY,
      lat: 37.1,
      lng: -119,
      recordedAt: new Date(),
    })).resolves.toBeUndefined();
    expect(await getPendingPointCount()).toBe(1);
  });

  it("syncs points when the server accepts them", async () => {
    await queue(3);
    vi.stubGlobal("fetch", respondWith(200));
    const result = await flushPendingPoints();
    expect(result.synced).toBe(3);
    expect(result.pending).toBe(0);
  });

  it("keeps points for a retryable failure so nothing is lost offline", async () => {
    await queue(3);
    const offline = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", offline);
    const result = await flushPendingPoints();
    expect(result.synced).toBe(0);
    expect(result.pending).toBe(3);

    // Back online, they go up.
    vi.stubGlobal("fetch", respondWith(200));
    expect((await flushPendingPoints()).pending).toBe(0);
  });

  it("keeps points for a server error, which may recover", async () => {
    await queue(2);
    vi.stubGlobal("fetch", respondWith(503));
    expect((await flushPendingPoints()).pending).toBe(2);
  });

  /**
   * Regression: a permanent failure used to `break` and leave the points queued with
   * `synced: 0` forever. `deleteSyncedPointsOlderThan` only prunes `synced: 1`, so they
   * were never removed, while `usePointSync` retried every 30 s, on every `online`
   * event, and on every queue event — for the life of the app.
   *
   * That burns battery and cellular data in exactly the place this app tells people to
   * conserve both, and grows IndexedDB without bound in the same quota that holds the
   * offline route packs navigation depends on.
   *
   * A 404 means the activity does not exist for this owner — deleted, or created under a
   * different owner. It can never be uploaded, so retrying is pure cost.
   */
  it("stops retrying points that can never be accepted, and reports the loss", async () => {
    await queue(4);
    const gone = respondWith(404);
    vi.stubGlobal("fetch", gone);

    const result = await flushPendingPoints();
    expect(result.dropped).toBe(4);
    expect(result.pending).toBe(0);
    expect(await getPendingPointCount()).toBe(0);

    // And a second flush does not call the server again — there is nothing left to retry.
    const callsAfterFirstFlush = gone.mock.calls.length;
    await flushPendingPoints();
    expect(gone.mock.calls.length).toBe(callsAfterFirstFlush);
  });

  it("treats a rejected payload as permanent too", async () => {
    await queue(2);
    vi.stubGlobal("fetch", respondWith(400));
    const result = await flushPendingPoints();
    expect(result.dropped).toBe(2);
    expect(result.pending).toBe(0);
  });

  it("does not drop points on 401, which resolves on the next navigation", async () => {
    await queue(2);
    vi.stubGlobal("fetch", respondWith(401));
    const result = await flushPendingPoints();
    expect(result.dropped).toBe(0);
    expect(result.pending).toBe(2);
  });

  it("drops only the activity that is gone, not the whole queue", async () => {
    const alive = "22222222-2222-4222-8222-222222222222";
    await queue(2, ACTIVITY);
    await queue(3, alive);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).includes(ACTIVITY) ? new Response("", { status: 404 }) : new Response("{}", { status: 200 }),
      ),
    );
    const result = await flushPendingPoints();
    expect(result.dropped).toBe(2);
    expect(result.synced).toBe(3);
    expect(result.pending).toBe(0);
  });
});
