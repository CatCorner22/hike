import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as createPlan } from "./plans/route";
import { PATCH as updatePlan } from "./plans/[id]/route";
import { POST as createActivity } from "./activities/route";
import { PATCH as updateActivity } from "./activities/[id]/route";
import { GET as listPoints } from "./activities/[id]/points/route";
import { GET as searchTrails } from "./trails/search/route";
import { GET as listPlans, POST as createPlanRoute } from "./plans/route";
import { GET as getPlan, DELETE as deletePlanRoute } from "./plans/[id]/route";
import { GET as getActivity } from "./activities/[id]/route";
import { POST as addPoints } from "./activities/[id]/points/route";
import { OWNER_COOKIE, newOwnerId, signOwnerToken } from "@/lib/auth/owner";

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
    const created = (await createdResponse.json()) as { id: string };

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
        JSON.stringify({ name: "Updated" }),
      ),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(updatedResponse.status).toBe(200);
    await expect(updatedResponse.json()).resolves.toMatchObject({
      name: "Updated",
      notes: "Keep me",
    });
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
