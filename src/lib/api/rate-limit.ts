import { NextResponse } from "next/server";

interface Entry {
  count: number;
  resetAt: number;
}

/**
 * Process-local only. Multi-instance deployments must replace this with a
 * shared limiter (for example Redis) before relying on it as a global quota.
 *
 * Bounded on purpose. The map previously had no eviction at all, so every
 * distinct key lived forever: 20,000 requests with rotating `X-Forwarded-For`
 * values grew the server's RSS by 284 MB and nothing ever released it. The
 * server dying is a hiker-visible failure -- it is the thing they need at the
 * trailhead to download a route pack.
 */
const buckets = new Map<string, Entry>();
let nextPruneAt = 0;

/** Above this we stop tracking new keys rather than grow without limit. */
const MAX_TRACKED_KEYS = 20_000;

/**
 * Whether `X-Forwarded-For` may be believed.
 *
 * The header is client-controlled. Keying the limiter on it unconditionally
 * meant an attacker sending a fresh value per request was never limited at all
 * (measured: 0 of 40 requests refused while rotating the header, versus 20 of 40
 * with a fixed one). That matters because this limiter is what protects the
 * outbound Overpass and elevation calls; exhausting those gets the deployment
 * rate-limited or banned upstream, and then no hiker can download a route.
 *
 * Only trusted when the operator opts in, which is correct for a deployment
 * sitting behind exactly one proxy that overwrites the header.
 */
function trustForwardedFor(): boolean {
  return process.env.TRUST_PROXY_HEADERS === "true";
}

function clientKey(request: Request): string {
  if (trustForwardedFor()) {
    // Left-most entry is the original client when a trusted proxy appends.
    const forwarded = request.headers.get("x-forwarded-for");
    const first = forwarded?.split(",")[0]?.trim();
    if (first) return first;
    const real = request.headers.get("x-real-ip")?.trim();
    if (real) return real;
  }
  // Without a trusted proxy there is no reliable per-client identifier at this
  // layer, so everything shares one bucket. That is deliberately conservative:
  // it can throttle legitimate users, but the alternative is a limiter that
  // does nothing at all. The limits below are per-route and generous enough
  // that normal single-user operation never reaches them.
  return "shared";
}

function prune(now: number): void {
  for (const [key, entry] of buckets) {
    if (entry.resetAt <= now) buckets.delete(key);
  }
}

export function rateLimit(
  request: Request,
  route: string,
  limit = 12,
  windowMs = 60_000,
): NextResponse | null {
  const now = Date.now();
  const key = `${route}:${clientKey(request)}`;
  const current = buckets.get(key);

  if (!current || current.resetAt <= now) {
    // Expiry cleanup must be bounded too: sweeping every stored key for every
    // new client turns a key-rotation attack into quadratic CPU work. A periodic
    // sweep still releases expired buckets before they can accumulate.
    if (now >= nextPruneAt) {
      prune(now);
      nextPruneAt = now + 1_000;
    }
    if (!buckets.has(key) && buckets.size >= MAX_TRACKED_KEYS) {
      // Refuse rather than grow. Under key-rotation abuse this makes the
      // limiter fail closed for untracked keys instead of leaking memory.
      return tooMany(now + windowMs, now);
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return 1 <= limit ? null : tooMany(now + windowMs, now);
  }

  current.count += 1;
  return current.count <= limit ? null : tooMany(current.resetAt, now);
}

function tooMany(resetAt: number, now: number): NextResponse {
  return NextResponse.json(
    { error: "Too many requests. Please try again later." },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(Math.max(1, Math.ceil((resetAt - now) / 1000))),
      },
    },
  );
}

/** Test-only reset so suites do not leak counters into each other. */
export function __resetRateLimitForTests(): void {
  buckets.clear();
  nextPruneAt = 0;
}
