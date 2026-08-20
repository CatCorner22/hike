import { describe, expect, it, vi, beforeEach } from "vitest";

const store = {
  points: [] as Array<{ activityId: string; lat: number; lng: number; synced?: boolean }>,
};

vi.mock("@/lib/offline", () => ({
  getOfflineDb: async () => null,
  queueActivityPoint: async (point: { activityId: string; lat: number; lng: number }) => {
    store.points.push({ ...point, synced: false });
  },
}));

import { saveActivityPoint } from "./activity-sync";

describe("saveActivityPoint", () => {
  beforeEach(() => {
    store.points = [];
  });

  it("queues when the network throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const ok = await saveActivityPoint("act-1", {
      activityId: "act-1",
      lat: 37,
      lng: -119,
      recordedAt: new Date("2026-08-20T12:00:00Z"),
    });
    expect(ok).toBe(false);
    expect(store.points).toHaveLength(1);
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
