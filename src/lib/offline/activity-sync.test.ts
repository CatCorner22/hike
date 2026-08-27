import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetActivitySyncForTests,
  beginActivity,
  finishActivity,
  flushActivityQueue,
  flushPendingPoints as flushActivityPoints,
  getLocalActivity,
  listLocalActivities,
  loadOpenActivityRecovery,
  saveLocalActivitySnapshot,
  saveActivityPoint,
} from "./activity-sync";
import {
  __resetOfflineDbForTests,
  getOfflineDb,
  getPendingPoints,
} from "./index";

const STATS = {
  distanceMeters: 1_234,
  elevationGainMeters: 87,
  durationSeconds: 900,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(async () => {
  await __resetActivitySyncForTests();
  await __resetOfflineDbForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("saveActivityPoint", () => {
  it("queues durably before a network failure", async () => {
    const request = vi.fn(async (...args: Parameters<typeof fetch>) => {
      void args;
      throw new Error("offline");
    });
    vi.stubGlobal("fetch", request);

    const result = await saveActivityPoint("act-1", {
      lat: 37,
      lng: -119,
      recordedAt: new Date("2026-08-20T12:00:00Z"),
    });

    expect(result).toBe("queued");
    const stored = await getPendingPoints("act-1");
    expect(stored).toHaveLength(1);
    const sent = JSON.parse(String(request.mock.calls[0][1]?.body)) as { clientPointId: string };
    expect(sent.clientPointId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(stored[0].id).toBe(sent.clientPointId);
  });

  it("keeps a point queued for a retryable API error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 500 })));
    const result = await saveActivityPoint("act-1", {
      lat: 37,
      lng: -119,
      recordedAt: new Date(),
    });
    expect(result).toBe("queued");
    expect(await getPendingPoints("act-1")).toHaveLength(1);
  });

  it("marks the durable copy synced after a successful POST", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({})));
    const result = await saveActivityPoint("act-1", {
      lat: 37,
      lng: -119,
      recordedAt: new Date(),
    });
    expect(result).toBe("synced");
    expect(await getPendingPoints("act-1")).toHaveLength(0);
  });

  it("reconciles a finalized 409 once instead of queueing it forever", async () => {
    const finalized = vi.fn(async () => new Response("finalized", { status: 409 }));
    vi.stubGlobal("fetch", finalized);

    const result = await saveActivityPoint("act-1", {
      lat: 37,
      lng: -119,
      recordedAt: new Date(),
    });

    expect(result).toBe("rejected-finalized");
    expect(await getPendingPoints("act-1")).toHaveLength(0);
    await flushActivityQueue();
    expect(finalized).toHaveBeenCalledTimes(1);
  });
});

describe("stable local activity identity", () => {
  it("does not create a second server activity after online begin, finish, and flush", async () => {
    let creates = 0;
    let finishes = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/activities" && init?.method === "POST") {
        creates += 1;
        return json({ id: "remote-1" });
      }
      if (url === "/api/activities/remote-1" && init?.method === "PATCH") {
        finishes += 1;
        return json({ id: "remote-1" });
      }
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
    }));

    const started = await beginActivity({ trailId: "trail-1" });
    expect(started).toMatchObject({ remoteId: "remote-1", offline: false });
    expect(started.id).not.toBe("remote-1");
    expect(await getLocalActivity(started.id)).toMatchObject({
      id: started.id,
      remoteId: "remote-1",
    });

    await expect(finishActivity(started.id, STATS)).resolves.toMatchObject({
      synced: true,
      remoteId: "remote-1",
    });
    await flushActivityQueue();
    await flushActivityQueue();

    expect(creates).toBe(1);
    expect(finishes).toBe(1);
    expect(await listLocalActivities()).toHaveLength(1);
  });

  it("reuses the client activity UUID when the first committed response is lost", async () => {
    const serverActivities = new Map<string, { id: string }>();
    let creates = 0;
    let finishes = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/activities" && init?.method === "POST") {
        creates += 1;
        const body = JSON.parse(String(init.body)) as { clientActivityId: string };
        const committed = serverActivities.get(body.clientActivityId) ?? {
          id: body.clientActivityId,
        };
        serverActivities.set(body.clientActivityId, committed);
        if (creates === 1) throw new TypeError("response lost after commit");
        return json(committed);
      }
      if (url.startsWith("/api/activities/") && init?.method === "PATCH") {
        finishes += 1;
        return json({ id: url.slice("/api/activities/".length) });
      }
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
    }));

    const started = await beginActivity({ name: "Committed response-loss hike" });
    expect(started).toMatchObject({ offline: true });
    expect(serverActivities.get(started.id)).toEqual({ id: started.id });
    const localBeforeRetry = await getLocalActivity(started.id);
    expect(localBeforeRetry).toMatchObject({ id: started.id });
    expect(localBeforeRetry).not.toHaveProperty("remoteId");

    await expect(finishActivity(started.id, STATS)).resolves.toMatchObject({
      synced: true,
      remoteId: started.id,
    });
    await flushActivityQueue();

    expect(creates).toBe(2);
    expect(finishes).toBe(1);
    expect(serverActivities.size).toBe(1);
    expect(await listLocalActivities()).toHaveLength(1);
    expect(await getLocalActivity(started.id)).toMatchObject({
      id: started.id,
      remoteId: started.id,
      pendingStop: false,
    });
  });

  it("keeps a local recording when the server rejects start, and names the server error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "Invalid trail." }, 400)));
    const started = await beginActivity({ trailId: "not-a-trail" });
    expect(started).toMatchObject({
      offline: true,
      serverError: "Invalid trail.",
    });
    expect(await getLocalActivity(started.id)).toMatchObject({ id: started.id });
  });

  it("maps an offline session and its queued point to one remote activity before finishing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));
    const started = await beginActivity({ name: "Offline hike" });
    expect(started).toMatchObject({ offline: true });
    expect(await saveActivityPoint(started.id, {
      lat: 37.1,
      lng: -119.2,
      recordedAt: new Date("2026-08-20T12:00:00Z"),
    })).toBe("queued");
    expect(await getPendingPoints(started.id)).toHaveLength(1);

    let creates = 0;
    let pointPosts = 0;
    let finishes = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/activities" && init?.method === "POST") {
        creates += 1;
        return json({ id: "remote-offline" });
      }
      if (url === "/api/activities/remote-offline/points" && init?.method === "POST") {
        pointPosts += 1;
        return json({ id: "point-1" });
      }
      if (url === "/api/activities/remote-offline" && init?.method === "PATCH") {
        finishes += 1;
        return json({ id: "remote-offline" });
      }
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
    }));

    await expect(finishActivity(started.id, STATS)).resolves.toMatchObject({ synced: true });
    expect(creates).toBe(1);
    expect(pointPosts).toBe(1);
    expect(finishes).toBe(1);
    expect(await getPendingPoints(started.id)).toHaveLength(0);
    expect(await getPendingPoints("remote-offline")).toHaveLength(0);
  });
});

describe("open activity reload recovery", () => {
  it("finishes an offline Stop on reload without adopting the stale server-open row", async () => {
    let creates = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === "/api/activities" && init?.method === "POST") {
        creates += 1;
        return json({ id: "remote-pending-stop" });
      }
      throw new Error("offline after begin");
    }));
    const started = await beginActivity({ trailId: "trail-recovery" });
    await expect(finishActivity(started.id, STATS)).resolves.toMatchObject({ synced: false });
    expect(await getLocalActivity(started.id)).toMatchObject({
      id: started.id,
      remoteId: "remote-pending-stop",
      pendingStop: true,
      endedAt: expect.any(String),
    });

    // Hard reload: module memory is gone, IndexedDB remains. The final PATCH now works,
    // while the following GET deliberately returns a stale pre-PATCH open row.
    await __resetActivitySyncForTests();
    let finishes = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/activities/remote-pending-stop" && init?.method === "PATCH") {
        finishes += 1;
        return json({ id: "remote-pending-stop", endedAt: "2026-08-20T13:00:00.000Z" });
      }
      if (url === "/api/activities" && !init?.method) {
        return json({
          openActivities: [{
            id: "remote-pending-stop",
            trailId: "trail-recovery",
            startedAt: (await getLocalActivity(started.id))?.startedAt,
            endedAt: null,
          }],
        });
      }
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
    }));

    await expect(loadOpenActivityRecovery({ trailId: "trail-recovery" })).resolves.toEqual({
      status: "none",
    });
    expect(finishes).toBe(1);
    expect(creates).toBe(1);
    expect(await listLocalActivities()).toHaveLength(1);
    expect(await getLocalActivity(started.id)).toMatchObject({
      id: started.id,
      remoteId: "remote-pending-stop",
      pendingStop: false,
    });
  });

  it("blocks recovery while an offline Stop still cannot finish", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(json({ id: "remote-pending-stop" }))
      .mockRejectedValue(new Error("still offline")));
    const started = await beginActivity({ trailId: "trail-recovery" });
    await expect(finishActivity(started.id, STATS)).resolves.toMatchObject({ synced: false });
    await __resetActivitySyncForTests();

    const recovery = await loadOpenActivityRecovery({ trailId: "trail-recovery" });

    expect(recovery).toMatchObject({ status: "blocked", candidateCount: 1 });
    expect(await listLocalActivities()).toHaveLength(1);
    expect(await getLocalActivity(started.id)).toMatchObject({
      id: started.id,
      remoteId: "remote-pending-stop",
      pendingStop: true,
    });
  });

  it("recovers one local activity in paused-capable form when the server is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));
    const started = await beginActivity({ trailId: "trail-recovery" });
    await saveLocalActivitySnapshot(started.id, { ...STATS, pointCount: 7 });
    // Clear module memory while retaining IndexedDB: this is the hard-reload boundary.
    await __resetActivitySyncForTests();

    const recovery = await loadOpenActivityRecovery({ trailId: "trail-recovery" });

    expect(recovery).toMatchObject({
      status: "recovered",
      serverVerified: false,
      activity: {
        id: started.id,
        trailId: "trail-recovery",
        stats: { pointCount: 7 },
      },
    });
  });

  it("waits for an unmount snapshot to become durable before recovering its totals", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));
    const started = await beginActivity({ trailId: "trail-recovery" });
    const db = await getOfflineDb();
    if (!db) throw new Error("offline database unavailable");

    let releaseWrite: () => void = () => {};
    const writeReleased = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    let reportWriteStarted: () => void = () => {};
    const writeStarted = new Promise<void>((resolve) => {
      reportWriteStarted = resolve;
    });
    const originalPut = db.put.bind(db);
    const put = vi.spyOn(db, "put").mockImplementation(async (...args) => {
      reportWriteStarted();
      await writeReleased;
      return originalPut(...args);
    });

    // Effect cleanups cannot await. Start the same write and immediately model the
    // replacement recorder mounting after a client-side route transition.
    const snapshot = saveLocalActivitySnapshot(started.id, { ...STATS, pointCount: 19 });
    await writeStarted;
    await __resetActivitySyncForTests();
    let recoverySettled = false;
    const recoveryPromise = loadOpenActivityRecovery({ trailId: "trail-recovery" })
      .then((recovery) => {
        recoverySettled = true;
        return recovery;
      });

    await Promise.resolve();
    expect(recoverySettled).toBe(false);
    releaseWrite();
    await snapshot;

    await expect(recoveryPromise).resolves.toMatchObject({
      status: "recovered",
      activity: {
        id: started.id,
        stats: {
          distanceMeters: STATS.distanceMeters,
          elevationGainMeters: STATS.elevationGainMeters,
          durationSeconds: STATS.durationSeconds,
          pointCount: 19,
        },
      },
    });
    put.mockRestore();
  });

  it("blocks an offline local recording that belongs to another route", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));
    const started = await beginActivity({ trailId: "trail-other" });
    await saveLocalActivitySnapshot(started.id, { ...STATS, pointCount: 4 });
    await __resetActivitySyncForTests();

    const recovery = await loadOpenActivityRecovery({ trailId: "trail-current" });

    expect(recovery).toMatchObject({
      status: "blocked",
      candidateCount: 1,
      message: expect.stringContaining("belongs to another route"),
    });
    const preserved = await getLocalActivity(started.id);
    expect(preserved).toMatchObject({
      trailId: "trail-other",
      stats: { pointCount: 4 },
    });
    expect(preserved).not.toHaveProperty("endedAt");
  });

  it("adopts one server-only open activity under a new stable local ID", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({
      openActivities: [{
        id: "remote-recovery",
        trailId: "trail-recovery",
        planId: null,
        name: "Recovered hike",
        startedAt: "2026-08-20T12:00:00.000Z",
        endedAt: null,
        stats: { ...STATS, pointCount: 12 },
      }],
    })));

    const recovery = await loadOpenActivityRecovery({ trailId: "trail-recovery" });

    expect(recovery.status).toBe("recovered");
    if (recovery.status !== "recovered") throw new Error("expected recovery");
    expect(recovery.serverVerified).toBe(true);
    expect(recovery.activity.id).not.toBe("remote-recovery");
    expect(recovery.activity).toMatchObject({
      remoteId: "remote-recovery",
      trailId: "trail-recovery",
      stats: { pointCount: 12 },
    });
    expect(await getLocalActivity(recovery.activity.id)).toMatchObject({
      remoteId: "remote-recovery",
    });
  });

  it("blocks a server-only recording that belongs to another route", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({
      openActivities: [{
        id: "remote-other-route",
        trailId: "trail-other",
        planId: null,
        startedAt: "2026-08-20T12:00:00.000Z",
        endedAt: null,
      }],
    })));

    await expect(loadOpenActivityRecovery({ trailId: "trail-current" })).resolves.toMatchObject({
      status: "blocked",
      candidateCount: 1,
      message: expect.stringContaining("belongs to another route"),
    });
    expect(await listLocalActivities()).toHaveLength(0);
  });

  it("matches an offline local activity to the exact server activity without changing its local ID", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));
    const started = await beginActivity({
      trailId: "trail-recovery",
      name: "Exact hike",
    });
    const local = await getLocalActivity(started.id);
    if (!local) throw new Error("local activity missing");

    vi.stubGlobal("fetch", vi.fn(async () => json({
      openActivities: [{
        id: "remote-exact",
        trailId: "trail-recovery",
        planId: null,
        name: "Exact hike",
        startedAt: local.startedAt,
        endedAt: null,
        stats: STATS,
      }],
    })));
    const recovery = await loadOpenActivityRecovery({ trailId: "trail-recovery" });

    expect(recovery).toMatchObject({
      status: "recovered",
      serverVerified: true,
      activity: { id: started.id, remoteId: "remote-exact" },
    });
    expect(await listLocalActivities()).toHaveLength(1);
  });

  it("blocks multiple open candidates instead of guessing which GPS track to resume", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({
      openActivities: [
        {
          id: "remote-a",
          trailId: "trail-recovery",
          startedAt: "2026-08-20T12:00:00.000Z",
          endedAt: null,
        },
        {
          id: "remote-b",
          trailId: "trail-recovery",
          startedAt: "2026-08-20T13:00:00.000Z",
          endedAt: null,
        },
      ],
    })));

    await expect(loadOpenActivityRecovery({ trailId: "trail-recovery" })).resolves.toMatchObject({
      status: "blocked",
      candidateCount: 2,
    });
    expect(await listLocalActivities()).toHaveLength(0);
  });

  it("blocks a known local-to-server activity that the server no longer reports open", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(json({ id: "remote-closed" }))
      .mockResolvedValueOnce(json({ openActivities: [] }));
    vi.stubGlobal("fetch", request);
    const started = await beginActivity({ trailId: "trail-recovery" });

    await expect(loadOpenActivityRecovery({ trailId: "trail-recovery" })).resolves.toMatchObject({
      status: "blocked",
      candidateCount: 1,
    });
    expect(await getLocalActivity(started.id)).toMatchObject({ remoteId: "remote-closed" });
  });
});

describe("lossless finalization ordering", () => {
  it("does not PATCH the activity while a retryable point remains queued", async () => {
    let acceptPoints = false;
    const order: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/activities" && init?.method === "POST") {
        return json({ id: "remote-race" });
      }
      if (url === "/api/activities/remote-race/points" && init?.method === "POST") {
        order.push(acceptPoints ? "point-accepted" : "point-retryable");
        return acceptPoints ? json({ id: "point-race" }) : new Response("retry", { status: 503 });
      }
      if (url === "/api/activities/remote-race" && init?.method === "PATCH") {
        order.push("activity-finalized");
        return json({ id: "remote-race" });
      }
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
    }));

    const started = await beginActivity({ name: "Race regression" });
    expect(await saveActivityPoint(started.id, {
      lat: 37.2,
      lng: -119.3,
      recordedAt: new Date("2026-08-20T12:00:00Z"),
    })).toBe("queued");

    await expect(finishActivity(started.id, STATS)).resolves.toMatchObject({ synced: false });
    expect(order).toEqual(["point-retryable", "point-retryable"]);
    expect(await getPendingPoints("remote-race")).toHaveLength(1);

    acceptPoints = true;
    await flushActivityQueue();
    expect(order.slice(-2)).toEqual(["point-accepted", "activity-finalized"]);
    expect(await getPendingPoints("remote-race")).toHaveLength(0);
  });
});

/**
 * An owner change (cleared cookies, rotated SESSION_SECRET) makes the server answer 404
 * for every activity this device recorded — forever. Before re-homing existed, one
 * stranded pending Stop then blocked recording on the device permanently while the UI
 * said "reconnect and retry": a retry that could never succeed. These pin the escape
 * hatch: forget the dead remote identity, rotate the idempotency key (the old one still
 * names another owner's row, which the server answers with 409), and replay the whole
 * recording — every queued point — under whoever the current owner is.
 */
describe("re-homing after the server forgets the activity", () => {
  function rotatedWorld(options: { oldRemoteId: string; oldSyncIds: string[] }) {
    const calls = { creates: [] as string[], oldIdRequests: 0, newPoints: [] as string[], patched: 0 };
    const handler = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith(`/api/activities/${options.oldRemoteId}`)) {
        calls.oldIdRequests += 1;
        return json({ error: "Not found" }, 404);
      }
      if (url === "/api/activities" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { clientActivityId?: string };
        calls.creates.push(body.clientActivityId ?? "");
        if (options.oldSyncIds.includes(body.clientActivityId ?? "")) {
          return json({ error: "Activity could not be started with that idempotency key" }, 409);
        }
        return json({ id: "remote-rehomed" });
      }
      if (url === "/api/activities/remote-rehomed/points" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { clientPointId: string };
        calls.newPoints.push(body.clientPointId);
        return json({});
      }
      if (url === "/api/activities/remote-rehomed" && init?.method === "PATCH") {
        calls.patched += 1;
        return json({ id: "remote-rehomed" });
      }
      if (url === "/api/activities" && !init?.method) {
        return json({ openActivities: [] });
      }
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", handler);
    return calls;
  }

  it("finishes under the current owner with every queued point preserved", async () => {
    // Begun online: the server keys the activity by the client id, so remoteId === id.
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === "/api/activities" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { clientActivityId: string };
        return json({ id: body.clientActivityId });
      }
      throw new Error("offline");
    }));
    const started = await beginActivity({ trailId: "trail-rotate" });
    expect(started.remoteId).toBe(started.id);
    await saveActivityPoint(started.id, { lat: 37, lng: -119, recordedAt: new Date() });
    await saveActivityPoint(started.id, { lat: 37.001, lng: -119, recordedAt: new Date() });
    const queuedIds = (await getPendingPoints(started.id)).map((point) => point.id);
    expect(queuedIds).toHaveLength(2);

    const calls = rotatedWorld({ oldRemoteId: started.id, oldSyncIds: [started.id] });
    const result = await finishActivity(started.id, STATS);

    expect(result).toMatchObject({ synced: true, remoteId: "remote-rehomed", rejectedPoints: 0 });
    expect(calls.newPoints.sort()).toEqual([...queuedIds].sort());
    expect(calls.patched).toBe(1);
    expect(calls.creates.filter((id) => id !== started.id)).toHaveLength(1);
    expect(await getLocalActivity(started.id)).toMatchObject({
      id: started.id,
      remoteId: "remote-rehomed",
      pendingStop: false,
    });
    expect(await getPendingPoints("remote-rehomed")).toHaveLength(0);
    expect(await getPendingPoints(started.id)).toHaveLength(0);
  });

  it("unblocks reload recovery for a pending Stop stranded by the rotation", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === "/api/activities" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { clientActivityId: string };
        return json({ id: body.clientActivityId });
      }
      throw new Error("offline after begin");
    }));
    const started = await beginActivity({ trailId: "trail-rotate" });
    await expect(finishActivity(started.id, STATS)).resolves.toMatchObject({ synced: false });

    await __resetActivitySyncForTests();
    rotatedWorld({ oldRemoteId: started.id, oldSyncIds: [started.id] });

    await expect(loadOpenActivityRecovery({ trailId: "trail-rotate" })).resolves.toEqual({
      status: "none",
    });
    expect(await getLocalActivity(started.id)).toMatchObject({
      remoteId: "remote-rehomed",
      pendingStop: false,
    });
  });

  it("reports the unreachable activity from a flush without discarding a single point", async () => {
    const requests = vi.fn(async () => json({ error: "Not found" }, 404));
    vi.stubGlobal("fetch", requests);
    for (let index = 0; index < 3; index += 1) {
      await saveActivityPoint("remote-dead", {
        lat: 37 + index / 1000,
        lng: -119,
        recordedAt: new Date(),
      });
    }
    requests.mockClear();

    const result = await flushActivityPoints("remote-dead");
    expect(result).toMatchObject({ activityUnreachable: true, rejectedFinalized: 0, pending: 3 });
    expect(requests).toHaveBeenCalledTimes(1);
    expect(await getPendingPoints("remote-dead")).toHaveLength(3);
  });

  it("heals a live recording mid-hike so later fixes keep syncing", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === "/api/activities" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { clientActivityId: string };
        return json({ id: body.clientActivityId });
      }
      throw new Error("offline");
    }));
    const started = await beginActivity({ trailId: "trail-live" });

    const calls = rotatedWorld({ oldRemoteId: started.id, oldSyncIds: [started.id] });
    const result = await saveActivityPoint(started.id, {
      lat: 37,
      lng: -119,
      recordedAt: new Date(),
    });

    expect(result).toBe("synced");
    expect(calls.newPoints).toHaveLength(1);
    expect(await getLocalActivity(started.id)).toMatchObject({ remoteId: "remote-rehomed" });
    expect(await getPendingPoints(started.id)).toHaveLength(0);
    expect(await getPendingPoints("remote-rehomed")).toHaveLength(0);
  });

  it("deletes a fabricated row for an unknown server ID instead of blocking recovery forever", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "Not found" }, 404)));
    await expect(finishActivity("ghost-activity-id", STATS)).resolves.toMatchObject({
      synced: false,
    });
    expect(await listLocalActivities()).toHaveLength(0);

    vi.stubGlobal("fetch", vi.fn(async () => json({ openActivities: [] })));
    await expect(loadOpenActivityRecovery({})).resolves.toEqual({ status: "none" });
  });
});

/**
 * The other side of the same coin: the open-activity list no longer names the local
 * recording. That can mean "finished elsewhere" (block or adopt) or "gone for this
 * owner" (re-home) — only a direct lookup distinguishes them, and before it existed the
 * conflict branch blocked recording forever in the rotation case.
 */
describe("recovery conflict disambiguation", () => {
  async function openLocalRow(remoteId: string) {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === "/api/activities" && init?.method === "POST") {
        return json({ id: remoteId });
      }
      throw new Error("offline");
    }));
    const started = await beginActivity({ trailId: "trail-conflict" });
    await __resetActivitySyncForTests();
    return started;
  }

  it("re-homes when the direct lookup answers 404", async () => {
    const started = await openLocalRow("remote-conflict");
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/activities" && !init?.method) return json({ openActivities: [] });
      if (url === "/api/activities/remote-conflict") return json({ error: "Not found" }, 404);
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
    }));

    const recovery = await loadOpenActivityRecovery({ trailId: "trail-conflict" });
    expect(recovery.status).toBe("recovered");
    expect(await getLocalActivity(started.id)).toMatchObject({ remoteId: undefined });
  });

  it("adopts a finish made on another device when nothing is queued locally", async () => {
    const started = await openLocalRow("remote-conflict");
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/activities" && !init?.method) return json({ openActivities: [] });
      if (url === "/api/activities/remote-conflict") {
        return json({ activity: { id: "remote-conflict", endedAt: "2026-08-21T10:00:00.000Z" } });
      }
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
    }));

    await expect(loadOpenActivityRecovery({ trailId: "trail-conflict" })).resolves.toEqual({
      status: "none",
    });
    expect(await getLocalActivity(started.id)).toMatchObject({
      endedAt: "2026-08-21T10:00:00.000Z",
      pendingStop: false,
    });
  });

  it("keeps the protective block while queued points would be lost by adopting the finish", async () => {
    const started = await openLocalRow("remote-conflict");
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));
    await saveActivityPoint(started.id, { lat: 37, lng: -119, recordedAt: new Date() });

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/activities" && !init?.method) return json({ openActivities: [] });
      if (url === "/api/activities/remote-conflict") {
        return json({ activity: { id: "remote-conflict", endedAt: "2026-08-21T10:00:00.000Z" } });
      }
      if (url === "/api/activities/remote-conflict/points") return json({ error: "conflict" }, 409);
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
    }));

    const recovery = await loadOpenActivityRecovery({ trailId: "trail-conflict" });
    expect(recovery.status).toBe("blocked");
  });
});

/**
 * A double-tapped Start raced two beginActivity calls and left two open local rows;
 * recovery then blocked with ">1 unfinished recordings" and Retry re-counted the same
 * rows forever — recording permanently disabled by one mis-tap. An open row with no
 * server copy and not a single queued point is a failed start, not a recording:
 * nothing under it can be lost. The sweep runs only when multiple open rows exist, so
 * the ordinary crash-on-start case keeps its resume offer.
 */
describe("ghost starts cannot brick recovery", () => {
  it("sweeps empty duplicate starts and unblocks the device", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));
    await beginActivity({ trailId: "trail-dup" });
    await beginActivity({ trailId: "trail-dup" });
    await __resetActivitySyncForTests();

    vi.stubGlobal("fetch", vi.fn(async () => json({ openActivities: [] })));
    await expect(loadOpenActivityRecovery({ trailId: "trail-dup" })).resolves.toEqual({
      status: "none",
    });
    expect(await listLocalActivities()).toHaveLength(0);
  });

  it("never sweeps a row that has queued evidence — that one is offered for resume", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));
    const ghost = await beginActivity({ trailId: "trail-dup" });
    const real = await beginActivity({ trailId: "trail-dup" });
    await saveActivityPoint(real.id, { lat: 37, lng: -119, recordedAt: new Date() });
    await __resetActivitySyncForTests();

    vi.stubGlobal("fetch", vi.fn(async () => json({ openActivities: [] })));
    const recovery = await loadOpenActivityRecovery({ trailId: "trail-dup" });
    expect(recovery.status).toBe("recovered");
    if (recovery.status === "recovered") expect(recovery.activity.id).toBe(real.id);
    expect(await getLocalActivity(ghost.id)).toBeNull();
  });

  it("keeps offering a single crashed start for resume", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));
    const only = await beginActivity({ trailId: "trail-solo" });
    await __resetActivitySyncForTests();

    vi.stubGlobal("fetch", vi.fn(async () => json({ openActivities: [] })));
    const recovery = await loadOpenActivityRecovery({ trailId: "trail-solo" });
    expect(recovery.status).toBe("recovered");
    if (recovery.status === "recovered") expect(recovery.activity.id).toBe(only.id);
  });
});
