import { describe, expect, it } from "vitest";
// This intentionally remains on disk as an adversarial-test artifact.
process.env.LOCAL_STORE_PATH = `/tmp/hike-owner-store-${Date.now()}-${Math.random().toString(16).slice(2)}.json`;
const {
  createActivity,
  createPlan,
  deletePlan,
  getPlan,
  listActivities,
  listActivityPoints,
  listPlans,
  updatePlan,
} = await import("@/lib/store/local");

const ownerA = "A".repeat(43);
const ownerB = "B".repeat(43);

describe("device-scoped fallback store", () => {
  it("does not enumerate, read, update, or delete another device's plans", async () => {
    const plan = await createPlan({ ownerId: ownerA, name: "private A" });
    expect((await listPlans(ownerB)).map((item) => item.id)).not.toContain(plan.id);
    expect(await getPlan(plan.id, ownerB)).toBeNull();
    expect(await updatePlan(plan.id, ownerB, { notes: "cross-device mutation" })).toBeNull();
    expect(await deletePlan(plan.id, ownerB)).toBe(false);
    expect((await getPlan(plan.id, ownerA))?.notes).toBeNull();
  });

  it("does not expose another device's activity or precise points", async () => {
    const activity = await createActivity({
      ownerId: ownerA,
      name: "private track",
      startedAt: "2026-08-20T10:00:00Z",
    });
    expect((await listActivities(ownerB)).map((item) => item.id)).not.toContain(activity.id);
    expect(await listActivityPoints(activity.id, ownerB)).toEqual([]);
  });
});
