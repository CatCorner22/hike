import { beforeEach, describe, expect, it } from "vitest";
import { __resetRateLimitForTests } from "@/lib/api/rate-limit";
import { OWNER_COOKIE, newOwnerId, signOwnerToken } from "@/lib/auth/owner";
import { GET } from "./route.api";

beforeEach(() => {
  __resetRateLimitForTests();
  delete process.env.DATABASE_URL;
});

async function authed(trailId = "missing", cookie?: string) {
  const session = cookie ?? `${OWNER_COOKIE}=${await signOwnerToken(newOwnerId())}`;
  return GET(
    new Request(`http://localhost/api/research/${trailId}`, { headers: { cookie: session } }),
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

  it("rate-limits research per session so one caller cannot burn the model quota", async () => {
    const cookie = `${OWNER_COOKIE}=${await signOwnerToken(newOwnerId())}`;
    let last = 200;
    for (let i = 0; i < 7; i += 1) {
      last = (await authed("missing", cookie)).status;
    }
    expect(last).toBe(429);
  });

  it("does not let one session exhaust research for another", async () => {
    const a = `${OWNER_COOKIE}=${await signOwnerToken(newOwnerId())}`;
    const b = `${OWNER_COOKIE}=${await signOwnerToken(newOwnerId())}`;
    for (let i = 0; i < 6; i += 1) {
      expect((await authed("missing", a)).status).not.toBe(429);
    }
    expect((await authed("missing", b)).status).toBe(404);
  });
});
