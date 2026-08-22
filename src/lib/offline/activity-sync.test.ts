import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetActivitySyncForTests,
  beginActivity,
  finishActivity,
  flushActivityQueue,
  getLocalActivity,
  listLocalActivities,
  loadOpenActivityRecovery,
  saveLocalActivitySnapshot,
  saveActivityPoint,
} from "./activity-sync";
import {
  __resetOfflineDbForTests,
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
