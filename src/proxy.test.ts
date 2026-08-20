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
