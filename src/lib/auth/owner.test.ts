import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MissingSessionSecretError,
  newOwnerId,
  readCookie,
  requireOwner,
  signOwnerToken,
  verifyOwnerToken,
} from "./owner";

const SECRET = "test-secret-value";
const OTHER_SECRET = "a-different-secret";

describe("owner token", () => {
  it("round-trips an owner id", async () => {
    const ownerId = newOwnerId();
    const token = await signOwnerToken(ownerId, SECRET);
    expect(await verifyOwnerToken(token, SECRET)).toBe(ownerId);
  });

  it("mints a distinct id each time", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newOwnerId()));
    expect(ids.size).toBe(200);
  });

  /**
   * The whole point of the column: a client must not be able to name itself. If any of
   * these passed, `owner_id` would be decoration and every plan and GPS track would
   * still be readable by anyone who could guess or forge a value.
   */
  it("rejects a forged or edited token", async () => {
    const ownerId = newOwnerId();
    const token = await signOwnerToken(ownerId, SECRET);
    const [, signature] = token.split(".");

    expect(await verifyOwnerToken(ownerId, SECRET)).toBeNull();
    expect(await verifyOwnerToken(`${ownerId}.`, SECRET)).toBeNull();
    expect(await verifyOwnerToken(`.${signature}`, SECRET)).toBeNull();
    expect(await verifyOwnerToken(`${newOwnerId()}.${signature}`, SECRET)).toBeNull();
    expect(await verifyOwnerToken(`${ownerId}.${signature}x`, SECRET)).toBeNull();
    expect(await verifyOwnerToken(`${ownerId}.${"A".repeat(signature.length)}`, SECRET)).toBeNull();
    expect(await verifyOwnerToken("", SECRET)).toBeNull();
    expect(await verifyOwnerToken(undefined, SECRET)).toBeNull();
    expect(await verifyOwnerToken("not-a-token", SECRET)).toBeNull();
  });

  it("does not accept a token signed with another secret", async () => {
    const token = await signOwnerToken(newOwnerId(), OTHER_SECRET);
    expect(await verifyOwnerToken(token, SECRET)).toBeNull();
  });

  it("keeps an owner id containing dots intact", async () => {
    // Split on the LAST dot, so a provider subject like "auth0|a.b.c" survives.
    const ownerId = "auth0|user.with.dots";
    const token = await signOwnerToken(ownerId, SECRET);
    expect(await verifyOwnerToken(token, SECRET)).toBe(ownerId);
  });
});

describe("requireOwner", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function request(cookie?: string) {
    return new Request("http://localhost/api/plans", {
      headers: cookie ? { cookie } : {},
    });
  }

  it("accepts a validly signed cookie", async () => {
    vi.stubEnv("SESSION_SECRET", SECRET);
    const ownerId = newOwnerId();
    const token = await signOwnerToken(ownerId, SECRET);
    const result = await requireOwner(request(`hike_owner=${token}`));
    expect(result.ok).toBe(true);
    expect(result.ok && result.ownerId).toBe(ownerId);
  });

  it("401s with no cookie or a forged one", async () => {
    vi.stubEnv("SESSION_SECRET", SECRET);
    expect((await requireOwner(request())).ok).toBe(false);
    const denied = await requireOwner(request(`hike_owner=${newOwnerId()}.forged`));
    expect(denied.ok).toBe(false);
    expect(!denied.ok && denied.response.status).toBe(401);
  });

  /**
   * A missing secret must not degrade to "everybody shares one identity". Production
   * refuses the request outright rather than serving one person's plans to another.
   */
  it("accepts OWNER_TOKEN_SECRET as a legacy alias for SESSION_SECRET", async () => {
    // The CI workflow and some deployments were configured with the other name; a
    // rename must not lock every device out of its own data.
    vi.stubEnv("SESSION_SECRET", "");
    vi.stubEnv("OWNER_TOKEN_SECRET", SECRET);
    const ownerId = newOwnerId();
    const token = await signOwnerToken(ownerId);
    const result = await requireOwner(request(`hike_owner=${token}`));
    expect(result.ok).toBe(true);
    expect(result.ok && result.ownerId).toBe(ownerId);
  });

  it("fails closed in production when SESSION_SECRET is absent", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_SECRET", "");
    vi.stubEnv("OWNER_TOKEN_SECRET", "");
    const result = await requireOwner(request("hike_owner=anything"));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.response.status).toBe(503);
    expect(() => {
      throw new MissingSessionSecretError();
    }).toThrow(/SESSION_SECRET/);
  });
});

describe("readCookie", () => {
  function request(cookie: string) {
    return new Request("http://localhost/", { headers: { cookie } });
  }

  it("picks the right cookie out of a crowded header", () => {
    expect(readCookie(request("a=1; hike_owner=xyz; b=2"), "hike_owner")).toBe("xyz");
    expect(readCookie(request("hike_owner=xyz"), "hike_owner")).toBe("xyz");
    expect(readCookie(request("other=1"), "hike_owner")).toBeNull();
    expect(readCookie(new Request("http://localhost/"), "hike_owner")).toBeNull();
  });

  it("does not match a cookie whose name merely ends with the target", () => {
    expect(readCookie(request("not_hike_owner=nope"), "hike_owner")).toBeNull();
  });
});

/**
 * An unreadable cookie is not a valid session. A malformed percent escape used
 * to make decodeURIComponent throw, which surfaced to the client as HTTP 500.
 */
describe("readCookie tolerates malformed cookies", () => {
  it("returns null instead of throwing on a bad percent escape", () => {
    const request = new Request("https://example.test/api/plans", {
      headers: { cookie: "hike_owner=%E0%A4%A" },
    });
    expect(() => readCookie(request, "hike_owner")).not.toThrow();
    expect(readCookie(request, "hike_owner")).toBeNull();
  });

  it("still decodes a normal encoded cookie", () => {
    const request = new Request("https://example.test/", {
      headers: { cookie: "hike_owner=abc%2Ddef" },
    });
    expect(readCookie(request, "hike_owner")).toBe("abc-def");
  });
});
