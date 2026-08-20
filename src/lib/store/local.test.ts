import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addActivityPoint,
  createActivity,
  createPlan,
  deletePlan,
  getPlan,
  listActivityPoints,
  listPlans,
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
