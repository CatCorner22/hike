import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  flushPendingPoints,
  getPendingPointCount,
  getOfflineDb,
  getPendingPoints,
  ESTIMATED_PENDING_POINT_BYTES,
  MAX_PENDING_POINT_COUNT,
  MAX_PENDING_POINTS_PER_ACTIVITY,
  OfflinePointQueueFullError,
  ROUTE_PACK_STORAGE_RESERVE_BYTES,
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
  return vi.fn(async (...args: Parameters<typeof fetch>) => {
    void args;
    return new Response(status === 200 ? "{}" : "", { status });
  });
}

beforeEach(async () => {
  await __resetOfflineDbForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("point sync failure handling", () => {
  it("keeps recording beyond the old 2,000-point global cutoff when storage is available", async () => {
    const db = await getOfflineDb();
    if (!db) throw new Error("fake IndexedDB unavailable");
    const count = vi.spyOn(db, "countFromIndex").mockImplementation(async (_store, index) => {
      // Pretend the device already holds the retired 2,000-point global cutoff.
      return index === "by-synced" ? 2_000 : 0;
    });

    await expect(queueActivityPoint({
      activityId: ACTIVITY,
      lat: 37.7,
      lng: -119.6,
      recordedAt: new Date(1_700_000_000_000),
    })).resolves.toBeUndefined();
    count.mockRestore();
    expect(await getPendingPointCount()).toBe(1);
  }, 15_000);

  it.each([
    ["generous", ROUTE_PACK_STORAGE_RESERVE_BYTES + 10_000, true],
    ["exactly the reserved boundary", ROUTE_PACK_STORAGE_RESERVE_BYTES + ESTIMATED_PENDING_POINT_BYTES, true],
    ["one byte below the reserved boundary", ROUTE_PACK_STORAGE_RESERVE_BYTES + ESTIMATED_PENDING_POINT_BYTES - 1, false],
  ] as const)("handles %s storage headroom", async (_label, available, accepted) => {
    vi.stubGlobal("navigator", {
      storage: { estimate: vi.fn(async () => ({ usage: 1_000, quota: 1_000 + available })) },
    });
    const write = queueActivityPoint({
      activityId: ACTIVITY,
      lat: 37,
      lng: -119,
      recordedAt: new Date(),
    });
    if (accepted) await expect(write).resolves.toBeUndefined();
    else await expect(write).rejects.toBeInstanceOf(OfflinePointQueueFullError);
  });

  it("falls back to fixed queue bounds when storage estimates fail", async () => {
    vi.stubGlobal("navigator", {
      storage: { estimate: vi.fn(async () => { throw new Error("estimate unavailable"); }) },
    });
    await expect(queueActivityPoint({
      activityId: ACTIVITY,
      lat: 37,
      lng: -119,
      recordedAt: new Date(),
    })).resolves.toBeUndefined();
  });

  it("falls back to fixed queue bounds when StorageManager is unavailable", async () => {
    vi.stubGlobal("navigator", {});
    await expect(queueActivityPoint({
      activityId: ACTIVITY,
      lat: 37,
      lng: -119,
      recordedAt: new Date(),
    })).resolves.toBeUndefined();
  });

  it("serializes concurrent writes at the per-activity boundary", async () => {
    const db = await getOfflineDb();
    if (!db) throw new Error("fake IndexedDB unavailable");
    const count = vi.spyOn(db, "countFromIndex")
      .mockResolvedValueOnce(MAX_PENDING_POINTS_PER_ACTIVITY - 1)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(MAX_PENDING_POINTS_PER_ACTIVITY);

    const first = queueActivityPoint({
      activityId: ACTIVITY,
      lat: 37,
      lng: -119,
      recordedAt: new Date(1_700_000_000_000),
    });
    const second = queueActivityPoint({
      activityId: ACTIVITY,
      lat: 37.001,
      lng: -119,
      recordedAt: new Date(1_700_000_001_000),
    });
    await expect(first).resolves.toBeUndefined();
    await expect(second).rejects.toBeInstanceOf(OfflinePointQueueFullError);
    count.mockRestore();
    expect(await getPendingPointCount()).toBe(1);
  });

  it("rejects a point at the recording budget instead of consuming route-pack capacity", async () => {
    const db = await getOfflineDb();
    if (!db) throw new Error("fake IndexedDB unavailable");
    const count = vi.spyOn(db, "countFromIndex")
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(MAX_PENDING_POINT_COUNT);

    await expect(queueActivityPoint({
      activityId: ACTIVITY,
      lat: 38,
      lng: -120,
      recordedAt: new Date(),
    })).rejects.toMatchObject({
      name: "OfflinePointQueueFullError",
      message: expect.stringContaining("GPS point was not saved"),
    });
    count.mockRestore();
    expect(await getPendingPointCount()).toBe(0);
  });

  it("keeps one activity aligned with the server point ceiling", async () => {
    const db = await getOfflineDb();
    if (!db) throw new Error("fake IndexedDB unavailable");
    const count = vi.spyOn(db, "countFromIndex")
      .mockResolvedValueOnce(MAX_PENDING_POINTS_PER_ACTIVITY);

    await expect(queueActivityPoint({
      activityId: ACTIVITY,
      lat: 38,
      lng: -120,
      recordedAt: new Date(),
    })).rejects.toBeInstanceOf(OfflinePointQueueFullError);
    count.mockRestore();
    expect(await getPendingPointCount()).toBe(0);
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
    const accepted = respondWith(200);
    vi.stubGlobal("fetch", accepted);
    const result = await flushPendingPoints();
    expect(result.synced).toBe(3);
    expect(result.pending).toBe(0);
    const body = JSON.parse(String(accepted.mock.calls[0][1]?.body)) as {
      points: Array<{ clientPointId?: string }>;
    };
    expect(body.points).toHaveLength(3);
    expect(body.points.every((point) => /^[0-9a-f-]{36}$/i.test(point.clientPointId ?? ""))).toBe(true);
    const stored = await getPendingPoints(ACTIVITY);
    expect(stored).toHaveLength(0);
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

  it("never uploads a device-local activity ID before its server mapping exists", async () => {
    const localId = "local-activity";
    const remoteId = "33333333-3333-4333-8333-333333333333";
    const db = await getOfflineDb();
    if (!db) throw new Error("fake IndexedDB unavailable");
    await db.put("localActivities", {
      id: localId,
      startedAt: "2026-08-20T12:00:00.000Z",
      pendingStop: false,
    });
    await queue(1, localId);
    const request = respondWith(404);
    vi.stubGlobal("fetch", request);

    expect(await flushPendingPoints()).toMatchObject({ pending: 1, dropped: 0 });
    expect(request).not.toHaveBeenCalled();

    await db.put("localActivities", {
      id: localId,
      remoteId,
      startedAt: "2026-08-20T12:00:00.000Z",
      pendingStop: false,
    });
    const accepted = respondWith(200);
    vi.stubGlobal("fetch", accepted);
    expect(await flushPendingPoints()).toMatchObject({ pending: 0, synced: 1 });
    expect(String(accepted.mock.calls[0][0])).toContain(`/activities/${remoteId}/points`);
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

  it("drops a novel point rejected after finalization instead of retrying forever", async () => {
    await queue(2);
    const finalized = respondWith(409);
    vi.stubGlobal("fetch", finalized);

    const result = await flushPendingPoints();
    expect(result).toMatchObject({ dropped: 2, pending: 0, synced: 0 });

    const callsAfterFirstFlush = finalized.mock.calls.length;
    await flushPendingPoints();
    expect(finalized.mock.calls.length).toBe(callsAfterFirstFlush);
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

/**
 * The 30-second background flush and the re-homing path (activity-sync) share this
 * queue. A 404 during an owner change — cleared cookies, rotated SESSION_SECRET — used
 * to be treated as permanent here, so the background flush destroyed the only copy of
 * the track before re-homing ever ran. Now a 404 discards only true orphans: points
 * whose activity no local recording references any more.
 */
describe("owner-change 404s do not destroy re-homeable recordings", () => {
  const LOCAL_ID = "44444444-4444-4444-8444-444444444444";
  const REMOTE_ID = "55555555-5555-4555-8555-555555555555";

  async function putLocalRow(row: Record<string, unknown>) {
    const db = await getOfflineDb();
    if (!db) throw new Error("fake IndexedDB unavailable");
    await db.put("localActivities", {
      id: LOCAL_ID,
      startedAt: "2026-08-20T12:00:00.000Z",
      pendingStop: false,
      ...row,
    });
  }

  it("keeps every point of a live recording and stops after one 404", async () => {
    await putLocalRow({ remoteId: REMOTE_ID });
    await queue(202, REMOTE_ID);
    const gone = respondWith(404);
    vi.stubGlobal("fetch", gone);

    const result = await flushPendingPoints();

    expect(result.dropped).toBe(0);
    expect(result.pending).toBe(202);
    expect(await getPendingPointCount()).toBe(202);
    // Three batches were queued (100+100+2); the 404 must stop the flush after the first.
    expect(gone).toHaveBeenCalledTimes(1);
  });

  it("hands the kept points to the activity queue, which re-homes and syncs them", async () => {
    await putLocalRow({ remoteId: REMOTE_ID, endedAt: "2026-08-20T13:00:00.000Z", pendingStop: true });
    await queue(2, REMOTE_ID);
    const posted: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes(REMOTE_ID)) return new Response("nope", { status: 404 });
      if (url === "/api/activities" && init?.method === "POST") {
        return new Response(JSON.stringify({ id: "remote-rehomed" }), { status: 200 });
      }
      if (url === "/api/activities/remote-rehomed/points" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { clientPointId?: string };
        if (body.clientPointId) posted.push(body.clientPointId);
        return new Response("{}", { status: 200 });
      }
      if (url === "/api/activities/remote-rehomed" && init?.method === "PATCH") {
        return new Response("{}", { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }));

    const result = await flushPendingPoints();
    expect(result.dropped).toBe(0);

    // The re-homed replay is scheduled outside the flush's single-flight guard.
    await vi.waitFor(async () => {
      expect(await getPendingPointCount()).toBe(0);
    });
    expect(posted).toHaveLength(2);
  });

  it("still discards points for an activity this device fully completed", async () => {
    await putLocalRow({ remoteId: REMOTE_ID, endedAt: "2026-08-20T13:00:00.000Z", pendingStop: false });
    await queue(2, REMOTE_ID);
    vi.stubGlobal("fetch", respondWith(404));

    const result = await flushPendingPoints();
    expect(result.dropped).toBe(2);
    expect(result.pending).toBe(0);
  });
});

/**
 * The flush's completion used to dispatch "hike-points-queued" unconditionally, and
 * usePointSync flushes ON that event — after the single-flight guard was already
 * cleared. flush → event → flush, forever: an invisible busy loop burning battery in
 * exactly the app that tells hikers to conserve it. A flush that changes nothing must
 * be silent; one that syncs or drops points notifies once, and the single follow-up
 * flush that triggers goes quiet on its own.
 */
describe("flush completion events cannot self-retrigger forever", () => {
  function windowRecorder() {
    const dispatched: string[] = [];
    vi.stubGlobal("window", {
      dispatchEvent: (event: Event) => {
        dispatched.push(event.type);
        return true;
      },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
    vi.stubGlobal("Event", class { constructor(public type: string) {} });
    vi.stubGlobal("CustomEvent", class { constructor(public type: string, public detail?: unknown) {} });
    return dispatched;
  }

  it("stays silent on a flush that changes nothing", async () => {
    const dispatched = windowRecorder();
    vi.stubGlobal("fetch", respondWith(200));
    await flushPendingPoints();
    expect(dispatched.filter((type) => type === "hike-points-queued")).toHaveLength(0);
  });

  it("notifies exactly once when points actually synced, so one follow-up flush then quiescence", async () => {
    const dispatched = windowRecorder();
    await queue(2);
    dispatched.length = 0; // queueing notifies legitimately; the flush is under test
    vi.stubGlobal("fetch", respondWith(200));
    await flushPendingPoints();
    expect(dispatched.filter((type) => type === "hike-points-queued")).toHaveLength(1);
    // The follow-up flush a listener would run now finds nothing and stays silent.
    dispatched.length = 0;
    await flushPendingPoints();
    expect(dispatched.filter((type) => type === "hike-points-queued")).toHaveLength(0);
  });
});
