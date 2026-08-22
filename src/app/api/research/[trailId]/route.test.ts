import { beforeEach, describe, expect, it } from "vitest";
import { __resetRateLimitForTests } from "@/lib/api/rate-limit";
import { OWNER_COOKIE, newOwnerId, signOwnerToken } from "@/lib/auth/owner";
import { GET } from "./route";

beforeEach(() => {
  __resetRateLimitForTests();
  delete process.env.DATABASE_URL;
});

async function authed(trailId = "missing") {
  const cookie = `${OWNER_COOKIE}=${await signOwnerToken(newOwnerId())}`;
  return GET(
    new Request(`http://localhost/api/research/${trailId}`, { headers: { cookie } }),
    { params: Promise.resolve({ trailId }) },
  );
}

describe("GET /api/research/:trailId", () => {
  it("requires a session before doing any research work", async () => {
    const response = await GET(new Request("http://localhost/api/research/missing"), {
      params: Promise.resolve({ trailId: "missing" }),
    });
    expect(response.status).toBe(401);
  });

  it("rate-limits research so a client cannot burn the model quota", async () => {
    let last = 200;
    for (let i = 0; i < 7; i += 1) {
      last = (await authed()).status;
    }
    expect(last).toBe(429);
  });
});
