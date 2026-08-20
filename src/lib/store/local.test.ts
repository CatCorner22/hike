import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addActivityPoint,
  createActivity,
  createPlan,
  listActivityPoints,
  listPlans,
} from "./local";

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
        createPlan({ name: `Plan ${index}` }),
      ),
    );

    const plans = await listPlans();
    expect(plans).toHaveLength(count);
    expect(new Set(plans.map((plan) => plan.name)).size).toBe(count);
  });

  it("does not lose rapidly recorded activity points", async () => {
    const activity = await createActivity({ startedAt: new Date().toISOString() });
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

    await expect(createPlan({ name: "Must not overwrite" })).rejects.toThrow();
    expect(await readFile(storeFile, "utf8")).toBe('{"plans": [');
  });
});
