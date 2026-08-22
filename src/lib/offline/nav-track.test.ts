import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NavTrackStorageError,
  appendNavPoint,
  deleteNavSession,
  exportNavSession,
  finishNavSession,
  getActiveNavSession,
  getNavSession,
  listNavSessions,
  resetNavTrackDbForTests,
  resumeOrStartNavSession,
} from "./nav-track";

const DB_NAME = "hike-nav-tracks";

function deleteDatabase() {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("nav-track database deletion was blocked"));
  });
}

async function createV1Database(
  records: Array<{
    id: string;
    packId: string;
    name: string;
    startedAt: string;
    points: Array<{
      lat: number;
      lng: number;
      accuracy?: number;
      altitude?: number;
      recordedAt: string;
    }>;
  }>,
) {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("sessions", { keyPath: "id" });
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("sessions", "readwrite");
      for (const record of records) tx.objectStore("sessions").put(record);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  });
}

beforeEach(async () => {
  await resetNavTrackDbForTests();
  await deleteDatabase();
});

afterEach(async () => {
  await resetNavTrackDbForTests();
  vi.unstubAllGlobals();
});

describe("navigation track migration and recovery", () => {
  it("migrates every v1 point and resumes the newest route session", async () => {
    const olderPoints = Array.from({ length: 8_005 }, (_, index) => ({
      lat: 35 + index / 1_000_000,
      lng: -83,
      accuracy: 5,
      recordedAt: new Date(1_700_000_000_000 + index * 1_000).toISOString(),
    }));
    await createV1Database([
      {
        id: "old-session",
        packId: "plan-123",
        name: "Old hike",
        startedAt: "2026-08-20T10:00:00.000Z",
        points: olderPoints,
      },
      {
        id: "current-session",
        packId: "plan-123",
        name: "Current hike",
        startedAt: "2026-08-21T10:00:00.000Z",
        points: [
          {
            lat: 35.1,
            lng: -83.1,
            altitude: 600,
            recordedAt: "2026-08-21T10:00:01.000Z",
          },
        ],
      },
    ]);

    const active = await getActiveNavSession("plan-123");
    const older = await getNavSession("old-session");

    expect(active).toMatchObject({
      id: "current-session",
      status: "active",
      pointCount: 1,
    });
    expect(active?.points[0]).toMatchObject({
      pointId: "legacy:current-session:0",
      sequence: 0,
      altitude: 600,
    });
    expect(older).toMatchObject({
      status: "finished",
      pointCount: 8_005,
      nextSequence: 8_005,
    });
    expect(older?.points).toHaveLength(8_005);
    expect(older?.points[0].lat).toBe(35);
    expect(older?.points.at(-1)?.lat).toBeCloseTo(35.008004);
  });

  it("resumes the same active session and points after a connection reset", async () => {
    const first = await resumeOrStartNavSession("plan-remount", "Remount route");
    await appendNavPoint(first.sessionId, {
      pointId: "first-fix",
      lat: 35.9,
      lng: -83.9,
      recordedAt: 1_700_000_000_000,
    });

    await resetNavTrackDbForTests();
    const remounted = await resumeOrStartNavSession("plan-remount", "Remount route");
    const session = await getNavSession(remounted.sessionId);

    expect(first.resumed).toBe(false);
    expect(remounted).toEqual({ sessionId: first.sessionId, resumed: true });
    expect(session?.points).toHaveLength(1);
    expect(session?.points[0].pointId).toBe("first-fix");
  });
});

describe("navigation track append invariants", () => {
  it("allocates deterministic order for concurrent calls and deduplicates retries", async () => {
    const { sessionId } = await resumeOrStartNavSession("plan-race", "Concurrent route");
    const writes = Array.from({ length: 100 }, (_, index) =>
      appendNavPoint(sessionId, {
        pointId: `fix-${index}`,
        sourceKey: `sensor-${index}`,
        lat: 36 + index / 100_000,
        lng: -84,
        recordedAt: 1_700_000_000_000 + index,
      }),
    );
    await Promise.all(writes);
    await appendNavPoint(sessionId, {
      pointId: "fix-50",
      lat: 0,
      lng: 0,
      recordedAt: 0,
    });
    const replayedAfterReload = await appendNavPoint(sessionId, {
      pointId: "different-client-generated-id",
      sourceKey: "sensor-50",
      lat: 1,
      lng: 1,
      recordedAt: 1,
    });

    const session = await getNavSession(sessionId);
    expect(session?.pointCount).toBe(100);
    expect(session?.points.map((point) => point.sequence)).toEqual(
      Array.from({ length: 100 }, (_, index) => index),
    );
    expect(session?.points.map((point) => point.pointId)).toEqual(
      Array.from({ length: 100 }, (_, index) => `fix-${index}`),
    );
    expect(session?.points[50]).toMatchObject({ lat: 36.0005, lng: -84 });
    expect(replayedAfterReload.pointId).toBe("fix-50");
  });

  it("exports a transactionally consistent snapshot while appends are queued", async () => {
    const { sessionId } = await resumeOrStartNavSession("plan-snapshot", "Snapshot route");
    const writes = Array.from({ length: 40 }, (_, index) =>
      appendNavPoint(sessionId, {
        pointId: `snapshot-${index}`,
        lat: 36,
        lng: -84 + index / 100_000,
        recordedAt: 1_700_000_000_000 + index,
      }),
    );
    const snapshots = await Promise.all(
      Array.from({ length: 10 }, () => exportNavSession(sessionId)),
    );
    await Promise.all(writes);

    for (const snapshot of snapshots) {
      expect(snapshot.session.pointCount).toBe(snapshot.points.length);
      expect(snapshot.points.map((point) => point.sequence)).toEqual(
        Array.from({ length: snapshot.points.length }, (_, index) => index),
      );
    }
  });

  it(
    "keeps every point on a track longer than the retired 8,000-point cutoff",
    async () => {
      const { sessionId } = await resumeOrStartNavSession("plan-long", "Long route");
      await Promise.all(
        Array.from({ length: 8_001 }, (_, index) =>
          appendNavPoint(sessionId, {
            pointId: `long-${index}`,
            lat: 34 + index / 1_000_000,
            lng: -82,
            recordedAt: 1_700_000_000_000 + index,
          }),
        ),
      );

      const session = await getNavSession(sessionId);
      expect(session?.pointCount).toBe(8_001);
      expect(session?.points).toHaveLength(8_001);
      expect(session?.points[0].pointId).toBe("long-0");
      expect(session?.points.at(-1)?.pointId).toBe("long-8000");
    },
    30_000,
  );

  it("reports storage unavailability instead of pretending a track was saved", async () => {
    await resetNavTrackDbForTests();
    vi.stubGlobal("indexedDB", undefined);

    const write = resumeOrStartNavSession("plan-no-store", "No storage route");
    await expect(write).rejects.toMatchObject({
      code: "unavailable",
    } satisfies Partial<NavTrackStorageError>);
  });
});

describe("navigation track lifecycle contracts", () => {
  it("lists, exports, finishes, starts a successor, and deletes without orphaned points", async () => {
    const first = await resumeOrStartNavSession("plan-lifecycle", "Lifecycle route");
    await appendNavPoint(first.sessionId, {
      pointId: "lifecycle-fix",
      lat: 35,
      lng: -83,
      recordedAt: 1_700_000_000_000,
    });

    const exported = await exportNavSession(first.sessionId);
    expect(exported).toMatchObject({
      format: "klandagi-nav-track",
      version: 2,
      session: { id: first.sessionId, pointCount: 1 },
    });
    expect(exported.points[0].pointId).toBe("lifecycle-fix");

    await finishNavSession(first.sessionId, 1_700_000_100_000);
    expect(await getActiveNavSession("plan-lifecycle")).toBeNull();
    await expect(
      appendNavPoint(first.sessionId, { lat: 35.1, lng: -83.1 }),
    ).rejects.toMatchObject({ code: "finished" });

    const successor = await resumeOrStartNavSession("plan-lifecycle", "Lifecycle route");
    expect(successor.resumed).toBe(false);
    expect(successor.sessionId).not.toBe(first.sessionId);
    expect(await listNavSessions({ packId: "plan-lifecycle" })).toHaveLength(2);

    await expect(deleteNavSession(first.sessionId)).resolves.toBe(true);
    await expect(getNavSession(first.sessionId)).resolves.toBeNull();
    expect(await listNavSessions({ packId: "plan-lifecycle" })).toHaveLength(1);
  });
});
