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

let directory: string;

function jsonRequest(url: string, method: string, body: string) {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body,
  });
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "hike-routes-"));
  process.env.LOCAL_STORE_PATH = path.join(directory, "store.json");
  delete process.env.DATABASE_URL;
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

    const missing = await listPoints(new Request("http://localhost"), {
      params: Promise.resolve({ id: "missing" }),
    });
    expect(missing.status).toBe(404);
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
