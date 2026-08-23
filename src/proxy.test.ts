import { existsSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { OWNER_COOKIE, signOwnerToken, verifyOwnerToken } from "@/lib/auth/owner";
import { proxy } from "./proxy";

const SECRET = "proxy-test-secret";

function request(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(new URL(path, "https://example.test"), { headers });
}

function mintedOwner(response: Response): string | null {
  const header = response.headers.get("set-cookie");
  if (!header?.includes(`${OWNER_COOKIE}=`)) return null;
  return header.split(`${OWNER_COOKIE}=`)[1].split(";")[0];
}

describe("proxy owner minting", () => {
  it("mints a session for a document navigation", async () => {
    vi.stubEnv("SESSION_SECRET", SECRET);
    const response = await proxy(request("/plan", { "sec-fetch-dest": "document" }));
    const token = mintedOwner(response);
    expect(token).not.toBeNull();
    expect(await verifyOwnerToken(decodeURIComponent(token!), SECRET)).toBeTruthy();
    vi.unstubAllEnvs();
  });

  it("falls back to Accept for clients without Fetch Metadata", async () => {
    vi.stubEnv("SESSION_SECRET", SECRET);
    expect(mintedOwner(await proxy(request("/plan", { accept: "text/html" })))).not.toBeNull();
    vi.unstubAllEnvs();
  });

  /**
   * Regression: minting on *every* cookie-less request meant an anonymous API call
   * silently received a brand-new owner and could create rows, instead of the 401 the
   * handlers document. It also made the 401 branch unreachable in production and let a
   * crawler mint owners without limit. A browser gets its cookie from the document
   * response, so page fetches always carry one already.
   */
  it("does not mint for a subresource or API request", async () => {
    vi.stubEnv("SESSION_SECRET", SECRET);
    const cases: Array<Record<string, string>> = [
      { "sec-fetch-dest": "empty" },
      { "sec-fetch-dest": "script" },
      { "sec-fetch-dest": "image" },
      { accept: "*/*" },
      { accept: "application/json" },
      {},
    ];
    for (const headers of cases) {
      const response = await proxy(request("/api/plans", headers));
      expect(mintedOwner(response), JSON.stringify(headers)).toBeNull();
    }
    vi.unstubAllEnvs();
  });

  it("leaves an existing valid session alone", async () => {
    vi.stubEnv("SESSION_SECRET", SECRET);
    const token = await signOwnerToken("existing-owner", SECRET);
    const response = await proxy(
      request("/plan", { "sec-fetch-dest": "document", cookie: `${OWNER_COOKIE}=${token}` }),
    );
    expect(mintedOwner(response)).toBeNull();
    vi.unstubAllEnvs();
  });

  it("replaces a forged cookie rather than trusting it", async () => {
    vi.stubEnv("SESSION_SECRET", SECRET);
    const response = await proxy(
      request("/plan", {
        "sec-fetch-dest": "document",
        cookie: `${OWNER_COOKIE}=attacker-chosen-id.bogus-signature`,
      }),
    );
    const token = mintedOwner(response);
    expect(token).not.toBeNull();
    expect(decodeURIComponent(token!)).not.toContain("attacker-chosen-id");
    vi.unstubAllEnvs();
  });

  it("passes the request through when no secret is configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_SECRET", "");
    // Must not throw: failing the whole app closed here would take the offline
    // navigate shell down with it. The route handlers refuse instead.
    const response = await proxy(request("/plan", { "sec-fetch-dest": "document" }));
    expect(mintedOwner(response)).toBeNull();
    vi.unstubAllEnvs();
  });
});

/**
 * A response that establishes a session must never be stored by a shared cache.
 * Next labelled the minting document response `s-maxage=31536000`, so a CDN
 * could replay one hiker's owner cookie to every later visitor and hand them
 * that hiker's plans and recorded tracks.
 */
describe("session responses are not shareable", () => {
  it("marks a cookie-minting document response private and no-store", async () => {
    vi.stubEnv("SESSION_SECRET", SECRET);
    const response = await proxy(request("/plan", { accept: "text/html", "sec-fetch-dest": "document" }));
    expect(response.headers.get("set-cookie")).toContain("hike_owner=");
    const cacheControl = response.headers.get("cache-control") ?? "";
    expect(cacheControl).toMatch(/no-store/);
    expect(cacheControl).toMatch(/private/);
    expect(cacheControl).not.toMatch(/s-maxage/);
  });

  it("keeps owner-scoped pages out of shared caches even with a session", async () => {
    vi.stubEnv("SESSION_SECRET", SECRET);
    const token = await signOwnerToken("owner-1", SECRET);
    // The real page paths under query-param routing, plus legacy path shapes —
    // the prefix rule must cover both so a stale bookmark still stays private.
    for (const path of [
      "/plan",
      "/plan/detail?id=abc",
      "/plan/abc",
      "/activities",
      "/activities/detail?id=abc",
      "/navigate?target=plan-abc",
      "/navigate/plan-abc",
    ]) {
      const response = await proxy(
        request(path, {
          accept: "text/html",
          "sec-fetch-dest": "document",
          cookie: `${OWNER_COOKIE}=${token}`,
        }),
      );
      const cacheControl = response.headers.get("cache-control") ?? "";
      expect(cacheControl, `${path} was shareable`).toMatch(/private/);
      expect(cacheControl, `${path} was shareable`).toMatch(/no-store/);
      expect(response.headers.get("vary")?.toLowerCase()).toContain("cookie");
    }
  });

  it("leaves public pages cacheable", async () => {
    vi.stubEnv("SESSION_SECRET", SECRET);
    const token = await signOwnerToken("owner-1", SECRET);
    const response = await proxy(
      request("/guide", {
        accept: "text/html",
        "sec-fetch-dest": "document",
        cookie: `${OWNER_COOKIE}=${token}`,
      }),
    );
    // No private/no-store forced here: the guide is the same for everyone.
    expect(response.headers.get("cache-control") ?? "").not.toMatch(/no-store/);
  });
});

describe("single identity proxy", () => {
  it("does not leave a competing root middleware or proxy file", () => {
    const root = path.resolve(import.meta.dirname, "..");
    expect(existsSync(path.join(root, "middleware.ts"))).toBe(false);
    expect(existsSync(path.join(root, "proxy.ts"))).toBe(false);
  });
});

describe("CORS for the native shell", () => {
  /**
   * The shell fetches from capacitor://localhost with a Bearer header. Without these
   * headers WebKit blocks the response before auth is consulted. The grant must echo
   * only allowlisted origins, and must NOT include Allow-Credentials — the cookie stays
   * unreachable cross-origin by design.
   */
  it("answers a preflight from an allowed origin", async () => {
    const response = await proxy(
      new NextRequest("http://localhost/api/plans", {
        method: "OPTIONS",
        headers: {
          origin: "capacitor://localhost",
          "access-control-request-method": "POST",
          "access-control-request-headers": "authorization,content-type",
        },
      }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("capacitor://localhost");
    expect(response.headers.get("access-control-allow-headers")).toContain("authorization");
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
    expect(response.headers.get("vary")).toMatch(/origin/i);
  });

  it("stamps the allow-origin header on an actual API response", async () => {
    const response = await proxy(
      new NextRequest("http://localhost/api/plans", {
        headers: { origin: "capacitor://localhost" },
      }),
    );
    expect(response.headers.get("access-control-allow-origin")).toBe("capacitor://localhost");
  });

  it("grants nothing to an origin outside the allowlist", async () => {
    for (const origin of ["https://evil.example", "http://localhost:3000"]) {
      const preflight = await proxy(
        new NextRequest("http://localhost/api/plans", {
          method: "OPTIONS",
          headers: { origin, "access-control-request-method": "GET" },
        }),
      );
      expect(preflight.headers.get("access-control-allow-origin"), origin).toBeNull();
      const actual = await proxy(
        new NextRequest("http://localhost/api/plans", { headers: { origin } }),
      );
      expect(actual.headers.get("access-control-allow-origin"), origin).toBeNull();
    }
  });

  it("leaves non-API and originless requests untouched", async () => {
    const page = await proxy(
      new NextRequest("http://localhost/guide", { headers: { origin: "capacitor://localhost" } }),
    );
    expect(page.headers.get("access-control-allow-origin")).toBeNull();
    const plain = await proxy(new NextRequest("http://localhost/api/plans"));
    expect(plain.headers.get("access-control-allow-origin")).toBeNull();
  });
});
