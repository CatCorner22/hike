import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { configReport, type CheckStatus, type ConfigCheck } from "@/lib/config/environment";
import { getDb, hasDatabase } from "@/lib/db";
import { rateLimit } from "@/lib/api/rate-limit";

/**
 * Is this deployment actually able to do its job?
 *
 * Deliberately unauthenticated. A health check that needs a session cannot be
 * used by the thing that decides whether to route traffic here, and it cannot be
 * used by the person who just pressed Deploy and wants to know before a hiker
 * does. Everything it returns is a status and a sentence: no connection string,
 * no secret, no hostname of anything private, nothing an attacker learns that
 * `curl -I` would not already tell them.
 *
 * 200 means a hiker can save a plan and upload a track. 503 means they cannot,
 * and the body says which check failed and what to set.
 */
export const dynamic = "force-dynamic";

/** A hung database must not hang the health check; a slow answer is a failing answer. */
const DATABASE_PING_TIMEOUT_MS = 3_000;

/**
 * The reason a connection failed, in one line an operator can act on.
 *
 * Drizzle wraps the driver's error, so the top-level message is "Failed query:
 * select 1" and the fact anybody needs — refused, timed out, no such host, wrong
 * password — is one or two `cause` links down. Walk to the deepest cause and
 * prefer its `code`, which is the part that names the failure.
 *
 * Nothing here can carry the password: `pg` builds connection errors from the
 * host, port and database name, never the credential.
 */
function describeConnectionFailure(error: unknown): string {
  let current: unknown = error;
  let deepest: Error | null = null;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    deepest = current;
    current = (current as Error & { cause?: unknown }).cause;
  }
  if (!deepest) return "unknown error";
  const code = (deepest as Error & { code?: unknown }).code;
  const message = deepest.message.replace(/\s+/g, " ").trim().slice(0, 200);
  return typeof code === "string" && code.length > 0 ? `${code} — ${message}` : message;
}

async function databaseCheck(): Promise<ConfigCheck> {
  if (!hasDatabase()) {
    return {
      name: "database-reachable",
      status: process.env.ALLOW_LOCAL_STORE_IN_PRODUCTION === "true" ? "warn" : "fail",
      detail: "No database is configured, so nothing was pinged.",
    };
  }
  const started = Date.now();
  try {
    await Promise.race([
      getDb().execute(sql`select 1`),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`no answer within ${DATABASE_PING_TIMEOUT_MS} ms`)),
          DATABASE_PING_TIMEOUT_MS,
        ),
      ),
    ]);
    return {
      name: "database-reachable",
      status: "ok",
      detail: `Answered select 1 in ${Date.now() - started} ms.`,
    };
  } catch (error) {
    return {
      name: "database-reachable",
      status: "fail",
      detail: `The database did not answer: ${describeConnectionFailure(error)}`,
    };
  }
}

export async function GET(request: Request) {
  // Generous, but not unlimited: this endpoint is public and it opens a database
  // connection, so it must not be a way to exhaust the pool.
  const limited = rateLimit(request, "health", 120, 60_000);
  if (limited) return limited;

  const config = configReport();
  const database = await databaseCheck();
  const checks = [...config.checks, database];

  const status: CheckStatus = checks.some((check) => check.status === "fail")
    ? "fail"
    : checks.some((check) => check.status === "warn")
      ? "warn"
      : "ok";

  return NextResponse.json(
    {
      status,
      // A hiker's phone only needs the answer to this one question.
      canStoreUserData: status !== "fail",
      checks,
      checkedAt: new Date().toISOString(),
    },
    {
      status: status === "fail" ? 503 : 200,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
