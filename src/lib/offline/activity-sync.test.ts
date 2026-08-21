import { describe, expect, it, vi, beforeEach } from "vitest";

const store = {
  points: [] as Array<{ id?: string; activityId: string; lat: number; lng: number; synced?: boolean }>,
};

vi.mock("@/lib/offline", () => ({
  getOfflineDb: async () => null,
  queueActivityPoint: async (point: { id?: string; activityId: string; lat: number; lng: number }) => {
    store.points.push({ ...point, synced: false });
  },
}));

import { saveActivityPoint } from "./activity-sync";

describe("saveActivityPoint", () => {
  beforeEach(() => {
    store.points = [];
  });

  it("queues when the network throws", async () => {
    const request = vi.fn(async (...args: Parameters<typeof fetch>) => {
      void args;
      throw new Error("offline");
    });
    vi.stubGlobal("fetch", request);
    const ok = await saveActivityPoint("act-1", {
      activityId: "act-1",
      lat: 37,
      lng: -119,
      recordedAt: new Date("2026-08-20T12:00:00Z"),
    });
    expect(ok).toBe(false);
    expect(store.points).toHaveLength(1);
    const sent = JSON.parse(String(request.mock.calls[0][1]?.body)) as { clientPointId: string };
    expect(sent.clientPointId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(store.points[0].id).toBe(sent.clientPointId);
    vi.unstubAllGlobals();
  });

  it("queues when the API returns an error status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("no", { status: 500 })),
    );
    const ok = await saveActivityPoint("act-1", {
      activityId: "act-1",
      lat: 37,
      lng: -119,
      recordedAt: new Date(),
    });
    expect(ok).toBe(false);
    expect(store.points).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it("does not queue a successful POST", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
    const ok = await saveActivityPoint("act-1", {
      activityId: "act-1",
      lat: 37,
      lng: -119,
      recordedAt: new Date(),
    });
    expect(ok).toBe(true);
    expect(store.points).toHaveLength(0);
    vi.unstubAllGlobals();
  });
});
