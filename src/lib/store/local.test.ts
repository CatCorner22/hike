import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ActivityIdCollisionError,
  addActivityPoint,
  createActivity,
  createPlan,
  deletePlan,
  getPlan,
  isLocalStoreEnabled,
  listActivities,
  listActivityPoints,
  listPlans,
  LocalStoreDisabledError,
  nextIsoTimestamp,
  updatePlan,
} from "./local";

const OWNER = "owner-a";
const OTHER = "owner-b";

let directory: string;
let storeFile: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "hike-store-"));
  storeFile = path.join(directory, "store.json");
  process.env.LOCAL_STORE_PATH = storeFile;
});

afterEach(async () => {
  delete process.env.LOCAL_STORE_PATH;
  await rm(directory, { recursive: true, force: true });
});

describe("local store durability", () => {
  it("does not lose concurrent plan writes", async () => {
    const count = 40;
    await Promise.all(
      Array.from({ length: count }, (_, index) =>
        createPlan({ ownerId: OWNER, name: `Plan ${index}` }),
      ),
    );

    const plans = await listPlans(OWNER);
    expect(plans).toHaveLength(count);
    expect(new Set(plans.map((plan) => plan.name)).size).toBe(count);
  });

  it("does not lose rapidly recorded activity points", async () => {
    const activity = await createActivity({ ownerId: OWNER, startedAt: new Date().toISOString() });
    const count = 50;
    await Promise.all(
      Array.from({ length: count }, (_, index) =>
        addActivityPoint({
          activityId: activity.id,
          lat: 40 + index / 10_000,
          lng: -105,
          elevation: null,
          recordedAt: new Date(1_700_000_000_000 + index).toISOString(),
        }),
      ),
    );

    expect(await listActivityPoints(activity.id)).toHaveLength(count);
  });

  it("replays a stable client activity UUID without changing or duplicating the row", async () => {
    const clientActivityId = "66666666-6666-4666-8666-666666666666";
    const first = await createActivity({
      ownerId: OWNER,
      clientActivityId,
      name: "Original activity",
      startedAt: "2026-08-20T12:00:00.000Z",
    });

    const retry = await createActivity({
      ownerId: OWNER,
      clientActivityId,
      name: "Changed retry must be ignored",
      startedAt: "2026-08-21T12:00:00.000Z",
    });

    expect(retry).toEqual(first);
    expect(await listActivities(OWNER)).toEqual([first]);
  });

  it("fails closed when another owner reuses a client activity UUID", async () => {
    const clientActivityId = "77777777-7777-4777-8777-777777777777";
    const first = await createActivity({
      ownerId: OWNER,
      clientActivityId,
      startedAt: "2026-08-20T12:00:00.000Z",
    });

    await expect(createActivity({
      ownerId: OTHER,
      clientActivityId,
      startedAt: "2026-08-21T12:00:00.000Z",
    })).rejects.toBeInstanceOf(ActivityIdCollisionError);
    expect(await listActivities(OWNER)).toEqual([first]);
    expect(await listActivities(OTHER)).toEqual([]);
  });

  it("surfaces corruption instead of overwriting the store as empty", async () => {
    await writeFile(storeFile, '{"plans": [');

    await expect(createPlan({ ownerId: OWNER, name: "Must not overwrite" })).rejects.toThrow();
    expect(await readFile(storeFile, "utf8")).toBe('{"plans": [');
  });

  it("preserves valid JSON whose root shape is not a local store", async () => {
    const original = JSON.stringify({
      data: {
        plans: [{
          id: "recoverable-plan",
          ownerId: OWNER,
          name: "Good map",
          trailId: null,
          plannedDate: null,
          notes: null,
          waypoints: null,
          campgroundIds: [],
          customGeometry: null,
          createdAt: "2026-08-20T12:00:00.000Z",
          updatedAt: "2026-08-20T12:00:00.000Z",
        }],
        activities: [],
        points: [],
      },
    });
    await writeFile(storeFile, original);

    await expect(createPlan({ ownerId: OWNER, name: "Must not overwrite" }))
      .rejects.toThrow("Local store format is unrecognized");
    expect(await readFile(storeFile, "utf8")).toBe(original);
  });
});

describe("local store owner scoping", () => {
  it("never returns another owner's plans", async () => {
    const mine = await createPlan({ ownerId: OWNER, name: "Mine" });
    await createPlan({ ownerId: OTHER, name: "Theirs" });

    expect((await listPlans(OWNER)).map((p) => p.name)).toEqual(["Mine"]);
    expect((await listPlans(OTHER)).map((p) => p.name)).toEqual(["Theirs"]);
    expect(await getPlan(mine.id, OTHER)).toBeNull();
    expect(await getPlan(mine.id, OWNER)).not.toBeNull();
  });

  it("advances the plan revision when two writes land in the same millisecond", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(Date.parse(nextIsoTimestamp(future))).toBe(Date.parse(future) + 1);
    const created = await createPlan({ ownerId: OWNER, name: "Original" });
    const first = await updatePlan(created.id, OWNER, { name: "Tab A" });
    const second = await updatePlan(created.id, OWNER, { name: "Tab B" });
    expect(first?.updatedAt).not.toBe(created.updatedAt);
    expect(second?.updatedAt).not.toBe(first?.updatedAt);
    expect(Date.parse(second!.updatedAt)).toBeGreaterThan(Date.parse(first!.updatedAt));
  });

  it("refuses to update or delete across owners", async () => {
    const mine = await createPlan({ ownerId: OWNER, name: "Mine" });

    expect(await updatePlan(mine.id, OTHER, { name: "Hijacked" })).toBeNull();
    expect((await getPlan(mine.id, OWNER))!.name).toBe("Mine");

    expect(await deletePlan(mine.id, OTHER)).toBe(false);
    expect(await getPlan(mine.id, OWNER)).not.toBeNull();

    expect(await deletePlan(mine.id, OWNER)).toBe(true);
    expect(await getPlan(mine.id, OWNER)).toBeNull();
  });

  it("hides rows that predate owner scoping", async () => {
    const legacy = await createPlan({ ownerId: OWNER, name: "Legacy" });
    const raw = JSON.parse(await readFile(storeFile, "utf8"));
    raw.plans = raw.plans.map((p: { id: string }) =>
      p.id === legacy.id ? { ...p, ownerId: null } : p,
    );
    await writeFile(storeFile, JSON.stringify(raw));

    expect(await listPlans(OWNER)).toHaveLength(0);
    expect(await getPlan(legacy.id, OWNER)).toBeNull();
  });
});

/**
 * The store keeps an in-memory copy to avoid re-parsing the whole file on every
 * mutation. That is only safe if an external writer still wins, so assert it
 * rather than assuming it.
 */
describe("local store cache coherence", () => {
  it("sees a write made by another process", async () => {
    const file = process.env.LOCAL_STORE_PATH!;
    await createPlan({ ownerId: "owner-a", name: "first" });
    expect((await listPlans("owner-a")).length).toBe(1);

    // Simulate a second process replacing the file underneath us.
    const raw = JSON.parse(await readFile(file, "utf8"));
    raw.plans.push({
      id: "externally-added",
      ownerId: "owner-a",
      name: "added out of band",
      trailId: null,
      plannedDate: null,
      notes: null,
      waypoints: null,
      campgroundIds: [],
      customGeometry: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    // Bump mtime deliberately: some filesystems have coarse timestamps, and the
    // size change alone must also be enough to invalidate.
    await writeFile(file, JSON.stringify(raw));
    await utimes(file, new Date(Date.now() + 1000), new Date(Date.now() + 1000));

    const plans = await listPlans("owner-a");
    expect(plans.map((plan) => plan.id)).toContain("externally-added");
  });
});

describe("local store production gate", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    process.env.LOCAL_STORE_PATH = storeFile;
  });

  it("is enabled outside production", () => {
    expect(isLocalStoreEnabled()).toBe(true);
  });

  it("refuses to read or write in production without an explicit opt-in", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_LOCAL_STORE_IN_PRODUCTION", "");
    expect(isLocalStoreEnabled()).toBe(false);
    await expect(listPlans(OWNER)).rejects.toBeInstanceOf(LocalStoreDisabledError);
    await expect(createPlan({ ownerId: OWNER, name: "nope" })).rejects.toBeInstanceOf(
      LocalStoreDisabledError,
    );
  });

  it("allows the file fallback when production opts in", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_LOCAL_STORE_IN_PRODUCTION", "true");
    expect(isLocalStoreEnabled()).toBe(true);
    const plan = await createPlan({ ownerId: OWNER, name: "ci" });
    expect(plan.name).toBe("ci");
  });
});
