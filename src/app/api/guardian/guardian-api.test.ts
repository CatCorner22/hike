import { beforeEach, describe, expect, it } from "vitest";
import { OWNER_COOKIE, newOwnerId, signOwnerToken } from "@/lib/auth/owner";
import { __resetRateLimitForTests } from "@/lib/api/rate-limit";
import { newGuardianToken } from "@/lib/guardian/status";
import { POST as createGuardian } from "./route";
import { GET as getGuardian, PATCH as patchGuardian } from "./[id]/route";
import { POST as readPublicGuardian } from "./status/route";

let session: string;

function ownerRequest(url: string, method = "GET", body?: unknown) {
  return new Request(url, {
    method,
    headers: {
      cookie: `${OWNER_COOKIE}=${session}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(async () => {
  delete process.env.DATABASE_URL;
  session = await signOwnerToken(newOwnerId());
  __resetRateLimitForTests();
});

describe("Guardian API boundaries", () => {
  it("requires the signed owner session for creation", async () => {
    const response = await createGuardian(new Request("http://localhost/api/guardian", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ routeName: "Ridge", expiresInHours: 24 }),
    }));
    expect(response.status).toBe(401);
  });

  it("requires durable shared storage instead of pretending a link was saved", async () => {
    const response = await createGuardian(ownerRequest(
      "http://localhost/api/guardian",
      "POST",
      { routeName: "Ridge", expiresInHours: 24 },
    ));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/server storage/i),
    });
  });

  it("accepts only the four bounded status fields", async () => {
    const response = await createGuardian(ownerRequest(
      "http://localhost/api/guardian",
      "POST",
      {
        routeName: "Ridge",
        expiresInHours: 24,
        status: { progressPercent: 10, lat: 40.1, lng: -105.2 },
      },
    ));
    expect(response.status).toBe(400);
  });

  it("refuses a link that would expire before its agreed overdue time", async () => {
    const response = await createGuardian(ownerRequest(
      "http://localhost/api/guardian",
      "POST",
      {
        routeName: "Ridge",
        expiresInHours: 12,
        overdueAt: new Date(Date.now() + 13 * 60 * 60 * 1000).toISOString(),
      },
    ));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/expire before/i),
    });
  });

  it("does not silently fall back for owner reads or writes", async () => {
    const params = { params: Promise.resolve({ id: newOwnerId() }) };
    expect((await getGuardian(ownerRequest("http://localhost/api/guardian/id"), params)).status).toBe(503);
    expect((await patchGuardian(ownerRequest(
      "http://localhost/api/guardian/id",
      "PATCH",
      { action: "revoke" },
    ), params)).status).toBe(503);
  });

  it("keeps the bearer token out of a GET URL and refuses malformed bodies", async () => {
    const malformed = await readPublicGuardian(new Request("http://localhost/api/guardian/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "bad" }),
    }));
    expect(malformed.status).toBe(400);

    const valid = await readPublicGuardian(new Request("http://localhost/api/guardian/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: newGuardianToken() }),
    }));
    expect(valid.status).toBe(503);
    expect(valid.headers.get("Cache-Control")).toMatch(/no-store/);
    expect(valid.headers.get("Referrer-Policy")).toBe("no-referrer");
  });
});
