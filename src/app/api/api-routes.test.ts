import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as createPlan } from "./plans/route.api";
import { PATCH as updatePlan } from "./plans/[id]/route.api";
import { GET as listActivitiesRoute, POST as createActivity } from "./activities/route.api";
import { PATCH as updateActivity } from "./activities/[id]/route.api";
import { GET as listPoints } from "./activities/[id]/points/route.api";
import { GET as searchTrails } from "./trails/search/route.api";
import { GET as listPlans, POST as createPlanRoute } from "./plans/route.api";
import { GET as getPlan, DELETE as deletePlanRoute } from "./plans/[id]/route.api";
import { GET as getActivity } from "./activities/[id]/route.api";
import { POST as addPoints } from "./activities/[id]/points/route.api";
import { POST as mintSessionRoute } from "./session/route.api";
import { MAX_ACTIVITY_POINTS } from "@/lib/api/validate";
import { OWNER_COOKIE, newOwnerId, signOwnerToken, verifyOwnerToken } from "@/lib/auth/owner";

let directory: string;

// Every user-data route resolves its owner from the signed cookie, so the tests have to
// carry one the same way a browser does.
let session = "";
let otherSession = "";

function jsonRequest(url: string, method: string, body: string, cookie = session) {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json", cookie: `${OWNER_COOKIE}=${cookie}` },
    body,
  });
}

function getRequest(url: string, cookie = session) {
  return new Request(url, { headers: { cookie: `${OWNER_COOKIE}=${cookie}` } });
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "hike-routes-"));
  process.env.LOCAL_STORE_PATH = path.join(directory, "store.json");
  delete process.env.DATABASE_URL;
  session = await signOwnerToken(newOwnerId());
  otherSession = await signOwnerToken(newOwnerId());
});

afterEach(async () => {
  delete process.env.LOCAL_STORE_PATH;
  await rm(directory, { recursive: true, force: true });
});

describe("API input boundaries", () => {
  it("returns 400 for malformed JSON on create and update", async () => {
    const createResponse = await createPlan(
      jsonRequest("http://localhost/api/plans", "POST", "{broken"),
    );
    expect(createResponse.status).toBe(400);

    const updateResponse = await updatePlan(
      jsonRequest("http://localhost/api/plans/missing", "PATCH", "{broken"),
      { params: Promise.resolve({ id: "missing" }) },
    );
    expect(updateResponse.status).toBe(400);
  });

  it("validates plan updates and preserves omitted fields", async () => {
    const createdResponse = await createPlan(
      jsonRequest(
        "http://localhost/api/plans",
        "POST",
        JSON.stringify({ name: "Original", notes: "Keep me" }),
      ),
    );
    const created = (await createdResponse.json()) as { id: string; updatedAt: string };

    const invalid = await updatePlan(
      jsonRequest(
        `http://localhost/api/plans/${created.id}`,
        "PATCH",
        JSON.stringify({ plannedDate: "not-a-date" }),
      ),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(invalid.status).toBe(400);

    const updatedResponse = await updatePlan(
      jsonRequest(
        `http://localhost/api/plans/${created.id}`,
        "PATCH",
        JSON.stringify({ name: "Updated", updatedAt: created.updatedAt }),
      ),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(updatedResponse.status).toBe(200);
    await expect(updatedResponse.json()).resolves.toMatchObject({
      name: "Updated",
      notes: "Keep me",
    });
  });

  it("rejects unstructured waypoints instead of storing them", async () => {
    const createdResponse = await createPlan(
      jsonRequest(
        "http://localhost/api/plans",
        "POST",
        JSON.stringify({ name: "Waypoints", waypoints: { not: "an-array" } }),
      ),
    );
    expect(createdResponse.status).toBe(400);

    const valid = await createPlan(
      jsonRequest(
        "http://localhost/api/plans",
        "POST",
        JSON.stringify({
          name: "Waypoints",
          waypoints: [{ name: "Spring", lat: 36.1, lng: -84.1 }],
        }),
      ),
    );
    expect(valid.status).toBe(200);
    const created = (await valid.json()) as { id: string; updatedAt: string; waypoints: unknown };

    const patched = await updatePlan(
      jsonRequest(
        `http://localhost/api/plans/${created.id}`,
        "PATCH",
        JSON.stringify({
          updatedAt: created.updatedAt,
          waypoints: [{ name: "x", lat: 91, lng: 0 }],
        }),
      ),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(patched.status).toBe(400);
  });

  it("validates activity updates and returns 404 for orphan point lists", async () => {
    const createdResponse = await createActivity(
      jsonRequest("http://localhost/api/activities", "POST", "{}"),
    );
    const created = (await createdResponse.json()) as { id: string };

    const invalid = await updateActivity(
      jsonRequest(
        `http://localhost/api/activities/${created.id}`,
        "PATCH",
        JSON.stringify({ endedAt: "invalid", stats: { distance: "far" } }),
      ),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(invalid.status).toBe(400);

    // With a session, an unknown activity is a 404.
    const missing = await listPoints(getRequest("http://localhost/api/activities/missing/points"), {
      params: Promise.resolve({ id: "missing" }),
    });
    expect(missing.status).toBe(404);

    // Without one it is a 401: a caller with no identity must not learn whether an id
    // exists, so authentication is resolved before existence.
    const anonymous = await listPoints(new Request("http://localhost"), {
      params: Promise.resolve({ id: "missing" }),
    });
    expect(anonymous.status).toBe(401);
  });

  it.each([",0,1,2", "0,,1,2", "0,0,,2", "0,0,1,"])(
    "rejects blank bbox coordinates: %s",
    async (bbox) => {
      const response = await searchTrails(
        new Request(`http://localhost/api/trails/search?q=trail&bbox=${bbox}`),
      );
      expect(response.status).toBe(400);
    },
  );
});

describe("owner scoping", () => {
  async function createPlanAs(cookie: string, name: string) {
    const response = await createPlanRoute(
      jsonRequest("http://localhost/api/plans", "POST", JSON.stringify({ name }), cookie),
    );
    expect(response.status).toBe(200);
    return (await response.json()) as { id: string; name: string };
  }

  it("refuses user data with no session at all", async () => {
    const noCookie = new Request("http://localhost/api/plans");
    expect((await listPlans(noCookie)).status).toBe(401);

    const forged = new Request("http://localhost/api/plans", {
      headers: { cookie: `${OWNER_COOKIE}=${newOwnerId()}.not-a-real-signature` },
    });
    expect((await listPlans(forged)).status).toBe(401);
  });

  it("lists only the caller's own plans", async () => {
    await createPlanAs(session, "Mine");
    await createPlanAs(otherSession, "Theirs");

    const mine = (await (await listPlans(getRequest("http://localhost/api/plans"))).json()) as {
      plans: Array<{ name: string }>;
    };
    expect(mine.plans.map((plan) => plan.name)).toEqual(["Mine"]);

    const theirs = (await (
      await listPlans(getRequest("http://localhost/api/plans", otherSession))
    ).json()) as { plans: Array<{ name: string }> };
    expect(theirs.plans.map((plan) => plan.name)).toEqual(["Theirs"]);
  });

  it("answers 404 — not 403 — for another owner's plan, so ids are not confirmed", async () => {
    const plan = await createPlanAs(session, "Mine");
    const params = { params: Promise.resolve({ id: plan.id }) };

    const read = await getPlan(getRequest(`http://localhost/api/plans/${plan.id}`, otherSession), params);
    expect(read.status).toBe(404);

    const patched = await updatePlan(
      jsonRequest(`http://localhost/api/plans/${plan.id}`, "PATCH", JSON.stringify({ name: "Hijacked" }), otherSession),
      params,
    );
    expect(patched.status).toBe(404);

    const deleted = await deletePlanRoute(
      getRequest(`http://localhost/api/plans/${plan.id}`, otherSession),
      params,
    );
    expect(deleted.status).toBe(404);

    // Still intact and still ours.
    const mine = await getPlan(getRequest(`http://localhost/api/plans/${plan.id}`), params);
    expect(mine.status).toBe(200);
    expect((await mine.json()).name).toBe("Mine");
  });

  it("will not let another owner read or append to a GPS track", async () => {
    const activityResponse = await createActivity(
      jsonRequest("http://localhost/api/activities", "POST", JSON.stringify({}), session),
    );
    const activity = (await activityResponse.json()) as { id: string };
    const params = { params: Promise.resolve({ id: activity.id }) };
    const point = JSON.stringify({ lat: 40, lng: -105, recordedAt: "2026-08-20T12:00:00Z" });

    expect((await addPoints(jsonRequest(`http://localhost/api/activities/${activity.id}/points`, "POST", point, session), params)).status).toBe(200);
    expect((await addPoints(jsonRequest(`http://localhost/api/activities/${activity.id}/points`, "POST", point, otherSession), params)).status).toBe(404);
    expect((await listPoints(getRequest(`http://localhost/api/activities/${activity.id}/points`, otherSession), params)).status).toBe(404);
    expect((await getActivity(getRequest(`http://localhost/api/activities/${activity.id}`, otherSession), params)).status).toBe(404);

    // The owner still sees exactly the one point they recorded.
    const ours = (await (await listPoints(getRequest(`http://localhost/api/activities/${activity.id}/points`), params)).json()) as {
      points: unknown[];
    };
    expect(ours.points).toHaveLength(1);
  });

  it("deleting a plan that does not exist is also a 404", async () => {
    const id = newOwnerId();
    const response = await deletePlanRoute(getRequest(`http://localhost/api/plans/${id}`), {
      params: Promise.resolve({ id }),
    });
    expect(response.status).toBe(404);
  });
});

describe("activity integrity races", () => {
  async function createOwnedActivity() {
    const response = await createActivity(jsonRequest("http://localhost/api/activities", "POST", "{}"));
    expect(response.status).toBe(200);
    return (await response.json()) as { id: string };
  }

  async function seedActivityPoints(activityId: string, count: number) {
    const storePath = process.env.LOCAL_STORE_PATH!;
    const store = JSON.parse(await readFile(storePath, "utf8")) as {
      points: Array<Record<string, unknown>>;
    };
    store.points = Array.from({ length: count }, (_, index) => ({
      id: `seed-${index}`,
      activityId,
      lat: 35 + index / 1_000_000,
      lng: -84,
      elevation: null,
      recordedAt: new Date(1_700_000_000_000 + index * 1_000).toISOString(),
    }));
    await writeFile(storePath, JSON.stringify(store));
  }

  it("replays a committed activity create by client UUID without changing or duplicating it", async () => {
    const clientActivityId = "44444444-4444-4444-8444-444444444444";
    const first = await createActivity(
      jsonRequest(
        "http://localhost/api/activities",
        "POST",
        JSON.stringify({
          clientActivityId,
          name: "Original activity",
          startedAt: "2026-08-20T12:00:00.000Z",
        }),
      ),
    );
    expect(first.status).toBe(200);
    const original = await first.json() as {
      id: string;
      name: string;
      startedAt: string;
      createdAt: string;
    };
    expect(original.id).toBe(clientActivityId);

    const retry = await createActivity(
      jsonRequest(
        "http://localhost/api/activities",
        "POST",
        JSON.stringify({
          clientActivityId,
          name: "Changed retry must be ignored",
          startedAt: "2026-08-21T12:00:00.000Z",
        }),
      ),
    );
    expect(retry.status).toBe(200);
    await expect(retry.json()).resolves.toMatchObject(original);

    const listed = await listActivitiesRoute(getRequest("http://localhost/api/activities"));
    const body = await listed.json() as { activities: Array<{ id: string }> };
    expect(body.activities.filter((activity) => activity.id === clientActivityId)).toHaveLength(1);
  });

  it("fails closed when another owner presents the same activity idempotency key", async () => {
    const clientActivityId = "55555555-5555-4555-8555-555555555555";
    const first = await createActivity(
      jsonRequest(
        "http://localhost/api/activities",
        "POST",
        JSON.stringify({ clientActivityId }),
        session,
      ),
    );
    expect(first.status).toBe(200);

    const collision = await createActivity(
      jsonRequest(
        "http://localhost/api/activities",
        "POST",
        JSON.stringify({ clientActivityId }),
        otherSession,
      ),
    );
    expect(collision.status).toBe(409);

    const mine = await listActivitiesRoute(getRequest("http://localhost/api/activities", session));
    const theirs = await listActivitiesRoute(getRequest("http://localhost/api/activities", otherSession));
    expect((await mine.json()).activities).toHaveLength(1);
    expect((await theirs.json()).activities).toHaveLength(0);
  });

  it("validates clientActivityId while keeping legacy creates non-idempotent", async () => {
    const invalid = await createActivity(
      jsonRequest(
        "http://localhost/api/activities",
        "POST",
        JSON.stringify({ clientActivityId: "not-a-uuid" }),
      ),
    );
    expect(invalid.status).toBe(400);

    const first = await createActivity(jsonRequest("http://localhost/api/activities", "POST", "{}"));
    const second = await createActivity(jsonRequest("http://localhost/api/activities", "POST", "{}"));
    expect((await first.json()).id).not.toBe((await second.json()).id);
  });

  it("returns the first point for concurrent tuple retries and client-key retries", async () => {
    const activity = await createOwnedActivity();
    const params = { params: Promise.resolve({ id: activity.id }) };
    const tuplePayload = JSON.stringify({
      lat: 37.775,
      lng: -119.538,
      elevation: 1234,
      recordedAt: "2026-08-20T18:01:01.000Z",
    });
    const [first, retry] = await Promise.all([
      addPoints(jsonRequest(`http://localhost/api/activities/${activity.id}/points`, "POST", tuplePayload), params),
      addPoints(jsonRequest(`http://localhost/api/activities/${activity.id}/points`, "POST", tuplePayload), params),
    ]);
    expect([first.status, retry.status]).toEqual([200, 200]);
    expect((await first.json()).id).toBe((await retry.json()).id);

    const keyedFirst = await addPoints(
      jsonRequest(
        `http://localhost/api/activities/${activity.id}/points`,
        "POST",
        JSON.stringify({
          clientPointId: "durable-device-fix-1",
          lat: 37.7751,
          lng: -119.5379,
          recordedAt: "2026-08-20T18:01:02.000Z",
        }),
      ),
      params,
    );
    const keyedRetry = await addPoints(
      jsonRequest(
        `http://localhost/api/activities/${activity.id}/points`,
        "POST",
        JSON.stringify({
          clientPointId: "durable-device-fix-1",
          lat: 37.7752,
          lng: -119.5378,
          recordedAt: "2026-08-20T18:01:03.000Z",
        }),
      ),
      params,
    );
    expect((await keyedRetry.json()).id).toBe((await keyedFirst.json()).id);

    const listed = (await listPoints(
      getRequest(`http://localhost/api/activities/${activity.id}/points?limit=10`),
      params,
    ).then((response) => response.json())) as { points: unknown[] };
    expect(listed.points).toHaveLength(2);
  });

  it("rejects a mixed over-cap batch before persisting any novel point", async () => {
    const activity = await createOwnedActivity();
    const params = { params: Promise.resolve({ id: activity.id }) };
    const storePath = process.env.LOCAL_STORE_PATH!;
    await seedActivityPoints(activity.id, MAX_ACTIVITY_POINTS - 1);

    const response = await addPoints(
      jsonRequest(
        `http://localhost/api/activities/${activity.id}/points`,
        "POST",
        JSON.stringify({
          points: [
            {
              lat: 35,
              lng: -84,
              recordedAt: new Date(1_700_000_000_000).toISOString(),
            },
            { lat: 36, lng: -84, recordedAt: "2026-08-20T20:00:00.000Z" },
            { lat: 36.001, lng: -84, recordedAt: "2026-08-20T20:00:01.000Z" },
          ],
        }),
      ),
      params,
    );
    expect(response.status).toBe(413);

    const after = JSON.parse(await readFile(storePath, "utf8")) as {
      points: Array<{ lat: number }>;
    };
    expect(after.points).toHaveLength(MAX_ACTIVITY_POINTS - 1);
    expect(after.points.some((point) => point.lat === 36 || point.lat === 36.001)).toBe(false);
  });

  it("allows duplicate-only batches at the cap without adding rows", async () => {
    const activity = await createOwnedActivity();
    const params = { params: Promise.resolve({ id: activity.id }) };
    await seedActivityPoints(activity.id, MAX_ACTIVITY_POINTS);
    const duplicate = {
      lat: 35,
      lng: -84,
      recordedAt: new Date(1_700_000_000_000).toISOString(),
    };

    const response = await addPoints(
      jsonRequest(
        `http://localhost/api/activities/${activity.id}/points`,
        "POST",
        JSON.stringify({ points: [duplicate, duplicate] }),
      ),
      params,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { points: Array<{ id: string }> };
    expect(body.points.map((point) => point.id)).toEqual(["seed-0", "seed-0"]);

    const store = JSON.parse(await readFile(process.env.LOCAL_STORE_PATH!, "utf8")) as {
      points: unknown[];
    };
    expect(store.points).toHaveLength(MAX_ACTIVITY_POINTS);
  });

  it("stores an intra-batch duplicate once while preserving response order", async () => {
    const activity = await createOwnedActivity();
    const params = { params: Promise.resolve({ id: activity.id }) };
    const point = {
      clientPointId: "same-device-fix",
      lat: 37.5,
      lng: -119.5,
      recordedAt: "2026-08-20T20:01:00.000Z",
    };

    const response = await addPoints(
      jsonRequest(
        `http://localhost/api/activities/${activity.id}/points`,
        "POST",
        JSON.stringify({ points: [point, point] }),
      ),
      params,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { points: Array<{ id: string }> };
    expect(body.points).toHaveLength(2);
    expect(body.points[0].id).toBe(body.points[1].id);

    const listed = (await listPoints(
      getRequest(`http://localhost/api/activities/${activity.id}/points`),
      params,
    ).then((result) => result.json())) as { points: unknown[] };
    expect(listed.points).toHaveLength(1);
  });

  it("rejects a point after finalization and returns geometry derived from accepted points", async () => {
    const activity = await createOwnedActivity();
    const params = { params: Promise.resolve({ id: activity.id }) };
    for (const point of [
      { lat: 37.7749, lng: -119.5383, recordedAt: "2026-08-20T18:02:00.000Z" },
      { lat: 37.7751, lng: -119.5379, recordedAt: "2026-08-20T18:02:01.000Z" },
    ]) {
      expect((await addPoints(
        jsonRequest(`http://localhost/api/activities/${activity.id}/points`, "POST", JSON.stringify(point)),
        params,
      )).status).toBe(200);
    }
    expect((await updateActivity(
      jsonRequest(
        `http://localhost/api/activities/${activity.id}`,
        "PATCH",
        JSON.stringify({ endedAt: "2026-08-20T18:02:02.000Z" }),
      ),
      params,
    )).status).toBe(200);

    const late = await addPoints(
      jsonRequest(
        `http://localhost/api/activities/${activity.id}/points`,
        "POST",
        JSON.stringify({ lat: 37.7754, lng: -119.5375, recordedAt: "2026-08-20T18:02:02.000Z" }),
      ),
      params,
    );
    expect(late.status).toBe(409);

    const detail = await getActivity(getRequest(`http://localhost/api/activities/${activity.id}`), params);
    const detailBody = (await detail.json()) as {
      pointCount: number;
      activity: { trackGeometry: { coordinates: unknown[] } | null };
    };
    expect(detailBody.pointCount).toBe(2);
    expect(detailBody.activity.trackGeometry?.coordinates).toHaveLength(2);
  });

  it("returns a conflict instead of silently applying a stale full plan snapshot", async () => {
    const response = await createPlan(
      jsonRequest(
        "http://localhost/api/plans",
        "POST",
        JSON.stringify({ name: "Original", notes: "Original notes" }),
      ),
    );
    const plan = (await response.json()) as { id: string; updatedAt: string };
    const params = { params: Promise.resolve({ id: plan.id }) };
    const first = await updatePlan(
      jsonRequest(
        `http://localhost/api/plans/${plan.id}`,
        "PATCH",
        JSON.stringify({ name: "Name from tab A", notes: "Original notes", updatedAt: plan.updatedAt }),
      ),
      params,
    );
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { updatedAt: string };
    expect(firstBody.updatedAt).not.toBe(plan.updatedAt);
    const second = await updatePlan(
      jsonRequest(
        `http://localhost/api/plans/${plan.id}`,
        "PATCH",
        JSON.stringify({ name: "Original", notes: "Notes from tab B", updatedAt: plan.updatedAt }),
      ),
      params,
    );
    expect(second.status).toBe(409);
  });

  it("exposes every open activity separately from bounded activity history", async () => {
    const open = await createOwnedActivity();
    const closed = await createOwnedActivity();
    expect((await updateActivity(
      jsonRequest(
        `http://localhost/api/activities/${closed.id}`,
        "PATCH",
        JSON.stringify({ endedAt: "2026-08-20T19:00:00.000Z" }),
      ),
      { params: Promise.resolve({ id: closed.id }) },
    )).status).toBe(200);

    const response = await listActivitiesRoute(getRequest("http://localhost/api/activities"));
    const body = (await response.json()) as { openActivities: Array<{ id: string }> };
    expect(body.openActivities.map((activity) => activity.id)).toContain(open.id);
    expect(body.openActivities.map((activity) => activity.id)).not.toContain(closed.id);
  });
});

describe("Explore OSM trail ids", () => {
  it("creates plans and activities from osm-relation hrefs and rejects junk ids", async () => {
    const invalid = await createPlan(
      jsonRequest(
        "http://localhost/api/plans",
        "POST",
        JSON.stringify({ name: "Bad", trailId: "not-a-trail" }),
      ),
    );
    expect(invalid.status).toBe(400);

    const created = await createPlan(
      jsonRequest(
        "http://localhost/api/plans",
        "POST",
        JSON.stringify({
          name: "Half Dome",
          trailId: "osm-relation-123",
          customGeometry: {
            type: "LineString",
            coordinates: [
              [-119.5, 37.7],
              [-119.4, 37.8],
            ],
          },
        }),
      ),
    );
    expect(created.status).toBe(200);
    const plan = (await created.json()) as {
      id: string;
      trailId: string | null;
      customGeometry: { type: string };
      updatedAt: string;
    };
    expect(plan.trailId).toBe("osm-relation-123");
    expect(plan.customGeometry.type).toBe("LineString");

    const patched = await updatePlan(
      jsonRequest(
        `http://localhost/api/plans/${plan.id}`,
        "PATCH",
        JSON.stringify({ trailId: "osm-way-99", updatedAt: plan.updatedAt }),
      ),
      { params: Promise.resolve({ id: plan.id }) },
    );
    expect(patched.status).toBe(200);
    await expect(patched.json()).resolves.toMatchObject({ trailId: "osm-way-99" });

    const activity = await createActivity(
      jsonRequest(
        "http://localhost/api/activities",
        "POST",
        JSON.stringify({ trailId: "osm-relation-123" }),
      ),
    );
    expect(activity.status).toBe(200);
    await expect(activity.json()).resolves.toMatchObject({ trailId: "osm-relation-123" });

    const badActivity = await createActivity(
      jsonRequest(
        "http://localhost/api/activities",
        "POST",
        JSON.stringify({ trailId: "trail-xyz" }),
      ),
    );
    expect(badActivity.status).toBe(400);
  });
});


describe("POST /api/session (native shell mint)", () => {
  it("mints a verifiable owner token for a credential-less caller", async () => {
    const response = await mintSessionRoute(new Request("http://x/api/session", { method: "POST" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const { token } = (await response.json()) as { token: string };
    expect(await verifyOwnerToken(token)).toBeTruthy();
  });

  /** A re-mint with a still-valid credential must not abandon the caller's data. */
  it("is idempotent for an authenticated caller — same owner comes back", async () => {
    const ownerId = newOwnerId();
    const existing = await signOwnerToken(ownerId);
    const viaBearer = await mintSessionRoute(
      new Request("http://x/api/session", {
        method: "POST",
        headers: { authorization: `Bearer ${existing}` },
      }),
    );
    const bearerBody = (await viaBearer.json()) as { token: string };
    expect(await verifyOwnerToken(bearerBody.token)).toBe(ownerId);

    const viaCookie = await mintSessionRoute(
      new Request("http://x/api/session", {
        method: "POST",
        headers: { cookie: `${OWNER_COOKIE}=${existing}` },
      }),
    );
    const cookieBody = (await viaCookie.json()) as { token: string };
    expect(await verifyOwnerToken(cookieBody.token)).toBe(ownerId);
  });

  it("an invalid credential yields a FRESH owner, not an error", async () => {
    const response = await mintSessionRoute(
      new Request("http://x/api/session", {
        method: "POST",
        headers: { authorization: `Bearer ${newOwnerId()}.forged-signature` },
      }),
    );
    expect(response.status).toBe(200);
    const { token } = (await response.json()) as { token: string };
    const owner = await verifyOwnerToken(token);
    expect(owner).toBeTruthy();
  });

  it("a bearer-authenticated request reaches an owner route", async () => {
    const mint = await mintSessionRoute(new Request("http://x/api/session", { method: "POST" }));
    const { token } = (await mint.json()) as { token: string };
    const list = await listPlans(
      new Request("http://x/api/plans", { headers: { authorization: `Bearer ${token}` } }),
    );
    expect(list.status).toBe(200);
  });
});
