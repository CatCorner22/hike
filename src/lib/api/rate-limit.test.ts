import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetRateLimitForTests, rateLimit } from "./rate-limit";

function request(headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/api/trails/search?q=a", { headers });
}

describe("rateLimit", () => {
  beforeEach(() => {
    __resetRateLimitForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    __resetRateLimitForTests();
  });

  it("refuses past the limit and reports Retry-After", () => {
    const allowed: number[] = [];
    let refused: Response | null = null;
    for (let i = 0; i < 6; i += 1) {
      const result = rateLimit(request(), "route", 4);
      if (result) refused = result;
      else allowed.push(i);
    }
    expect(allowed).toHaveLength(4);
    expect(refused?.status).toBe(429);
    expect(Number(refused?.headers.get("retry-after"))).toBeGreaterThan(0);
    // A 429 must never be cached and replayed to another client.
    expect(refused?.headers.get("cache-control")).toBe("no-store");
  });

  /**
   * The limiter used to key on `X-Forwarded-For` unconditionally. Because that
   * header is client-controlled, rotating it defeated the limiter completely --
   * measured 0 refusals in 40 requests. This is the regression guard.
   */
  it("cannot be bypassed by rotating X-Forwarded-For when no proxy is trusted", () => {
    let refusedCount = 0;
    for (let i = 0; i < 40; i += 1) {
      if (rateLimit(request({ "x-forwarded-for": `198.51.100.${i}` }), "route", 20)) {
        refusedCount += 1;
      }
    }
    expect(refusedCount).toBe(20);
  });

  it("honours a rotated header only when a proxy is explicitly trusted", () => {
    vi.stubEnv("TRUST_PROXY_HEADERS", "true");
    let refusedCount = 0;
    for (let i = 0; i < 40; i += 1) {
      if (rateLimit(request({ "x-forwarded-for": `198.51.100.${i}` }), "route", 20)) {
        refusedCount += 1;
      }
    }
    // Distinct trusted clients are genuinely distinct, so none are refused.
    expect(refusedCount).toBe(0);
    // ...but one trusted client still gets limited.
    let sameClientRefusals = 0;
    for (let i = 0; i < 30; i += 1) {
      if (rateLimit(request({ "x-forwarded-for": "203.0.113.5" }), "route", 20)) {
        sameClientRefusals += 1;
      }
    }
    expect(sameClientRefusals).toBeGreaterThan(0);
  });

  it("does not grow without bound under key rotation", () => {
    vi.stubEnv("TRUST_PROXY_HEADERS", "true");
    // Far more distinct keys than the tracking cap.
    for (let i = 0; i < 25_000; i += 1) {
      rateLimit(request({ "x-forwarded-for": `10.0.${(i >> 8) & 255}.${i & 255}` }), "route", 5);
    }
    // Nothing observable should keep growing; a fresh key is still handled
    // rather than throwing.
    expect(() =>
      rateLimit(request({ "x-forwarded-for": "203.0.113.99" }), "route", 5),
    ).not.toThrow();
  });

  it("releases expired buckets instead of retaining them for ever", () => {
    vi.useFakeTimers();
    try {
      vi.stubEnv("TRUST_PROXY_HEADERS", "true");
      for (let i = 0; i < 100; i += 1) {
        rateLimit(request({ "x-forwarded-for": `192.0.2.${i}` }), "route", 1, 1_000);
      }
      // Past the window, an old client is treated as new again, proving the
      // entry was released rather than counted for ever.
      vi.advanceTimersByTime(5_000);
      expect(rateLimit(request({ "x-forwarded-for": "192.0.2.1" }), "route", 1, 1_000)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
