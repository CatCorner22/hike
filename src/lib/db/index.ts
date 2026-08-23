import { drizzle as drizzleNeonHttp } from "drizzle-orm/neon-http";
import { drizzle as drizzlePostgres, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { neon } from "@neondatabase/serverless";
import { Pool } from "pg";
import * as schema from "./schema";

export type DatabaseDriver = "neon-http" | "postgres";

/**
 * Which client to talk to `DATABASE_URL` with.
 *
 * `@neondatabase/serverless`'s `neon()` is not a Postgres client — it sends SQL
 * over HTTPS to a Neon endpoint (its `fetchEndpoint` defaults to
 * `host => 'https://' + host + '/sql'`). It is the right driver on a serverless
 * host, where a TCP pool per invocation is waste, and it is what the Vercel +
 * Neon path in docs/deploy.md uses. It is also completely unable to talk to an
 * ordinary Postgres — which is what most other hosts, including a Replit
 * database, are likely to hand over.
 *
 * So the default leans the safe way. `pg` speaks the wire protocol every
 * Postgres understands, Neon included, so guessing "postgres" wrongly still
 * works; guessing "neon-http" wrongly fails outright. Only a host we can
 * positively identify as Neon gets the HTTP driver.
 *
 * `DATABASE_DRIVER` overrides the guess, so a host that defeats it is one
 * environment variable away from working rather than a code change away.
 */
export function resolveDatabaseDriver(
  url: string | undefined = process.env.DATABASE_URL,
  override: string | undefined = process.env.DATABASE_DRIVER,
): DatabaseDriver {
  if (override === "neon-http" || override === "postgres") return override;
  if (!url) return "postgres";
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    // An unparseable URL is the connecting driver's problem to report, with the
    // real error. Do not let it decide the driver by accident.
    return "postgres";
  }
  return hostname.endsWith(".neon.tech") ? "neon-http" : "postgres";
}

/**
 * Both adapters expose the same query builder and relational API, and nothing
 * on the server uses transactions (the `db.transaction(...)` calls elsewhere in
 * this app are IndexedDB, in the browser). Typing the seam as one of them keeps
 * all sixteen call sites unchanged.
 */
type Database = NodePgDatabase<typeof schema>;

let db: Database | null = null;
let pool: Pool | null = null;
let announced = false;

function announce(driver: DatabaseDriver, host: string): void {
  if (announced) return;
  announced = true;
  // Said once, out loud. A driver chosen wrongly should be visible in the first
  // lines of a deployment's logs rather than inferred later from a stack trace.
  console.info(`[db] using the ${driver} driver for ${host}`);
}

export function getDb(): Database {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not configured. Set it to a Postgres connection string " +
        "(any host — Replit, Neon, or your own), or add one to .env.local for local work.",
    );
  }
  if (!db) {
    const driver = resolveDatabaseDriver(url);
    let host = "the configured database";
    try {
      host = new URL(url).hostname;
    } catch {
      // Keep the placeholder; never echo the URL itself, it carries credentials.
    }
    announce(driver, host);

    if (driver === "neon-http") {
      db = drizzleNeonHttp(neon(url), { schema }) as unknown as Database;
    } else {
      // Modest ceiling: on an autoscaling host every container holds its own
      // pool, and Postgres connection slots are the shared resource.
      pool = new Pool({ connectionString: url, max: 5 });
      db = drizzlePostgres(pool, { schema });
    }
  }
  return db;
}

export function hasDatabase() {
  return Boolean(process.env.DATABASE_URL);
}

/** Test-only: drop the memoised client so a different DATABASE_URL takes effect. */
export async function __resetDbForTests(): Promise<void> {
  db = null;
  announced = false;
  const closing = pool;
  pool = null;
  await closing?.end();
}
