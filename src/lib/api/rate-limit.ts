import { NextResponse } from "next/server";

interface Entry { count: number; resetAt: number }
const buckets = new Map<string, Entry>();

/**
 * Process-local only. Multi-instance deployments must replace this with a
 * shared limiter (for example Redis) before relying on it as a global quota.
 */
export function rateLimit(request: Request, route: string, limit = 12, windowMs = 60_000): NextResponse | null {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  const key = `${route}:${ip}`;
  const now = Date.now();
  const current = buckets.get(key);
  const entry = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + windowMs }
    : current;
  entry.count += 1;
  buckets.set(key, entry);
  if (entry.count <= limit) return null;
  return NextResponse.json(
    { error: "Too many requests. Please try again later." },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))),
      },
    },
  );
}
