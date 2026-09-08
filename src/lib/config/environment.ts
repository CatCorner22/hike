import { resolveDatabaseDriver } from "@/lib/db";

/**
 * What this deployment is actually configured to do, decided in one place.
 *
 * The app has always been able to boot into a state where it looks fine and
 * serves nothing useful: no `DATABASE_URL` and no explicit fallback means every
 * user-data route answers 503, and the only way to find out was for a hiker to
 * try to save a route at a trailhead. This module turns that into something a
 * deploy can check in one request, and something the first ten lines of a log
 * say out loud.
 *
 * Nothing here reads a secret's value. A connection string carries credentials
 * and a session secret is the credential, so both are reported as present or
 * absent and — for the database — by hostname only.
 */

/**
 * Just the shape this module reads. Narrower than `NodeJS.ProcessEnv` on
 * purpose: `process.env` satisfies it, and a test can pass three keys without
 * having to invent a NODE_ENV.
 */
export type Environment = Record<string, string | undefined>;

export type CheckStatus = "ok" | "warn" | "fail";

export interface ConfigCheck {
  name: string;
  status: CheckStatus;
  /** One sentence a person can act on. Never contains a secret. */
  detail: string;
}

export interface ConfigReport {
  /** The worst status among the checks: what a health probe should answer with. */
  status: CheckStatus;
  checks: ConfigCheck[];
}

/**
 * Long enough that an HMAC over it is not the weak link. Sixteen bytes of real
 * entropy is the floor; the deploy docs ask for thirty-two.
 */
const MIN_SESSION_SECRET_LENGTH = 16;

function databaseHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "an unparseable URL";
  }
}

function sessionSecretCheck(env: Environment): ConfigCheck {
  const secret = env.SESSION_SECRET;
  if (!secret) {
    return {
      name: "session-secret",
      status: "fail",
      detail:
        "SESSION_SECRET is not set, so no owner identity can be signed and every " +
        "user-data request will be refused. Set it to 32 random bytes.",
    };
  }
  if (secret.length < MIN_SESSION_SECRET_LENGTH) {
    return {
      name: "session-secret",
      status: "warn",
      detail:
        `SESSION_SECRET is only ${secret.length} characters. Anything a person could ` +
        "guess or brute-force lets someone else read this hiker's plans and tracks.",
    };
  }
  return { name: "session-secret", status: "ok", detail: "A session secret is configured." };
}

function storageCheck(env: Environment): ConfigCheck {
  const url = env.DATABASE_URL;
  if (url) {
    const driver = resolveDatabaseDriver(url, env.DATABASE_DRIVER);
    return {
      name: "storage",
      status: "ok",
      detail: `Using the ${driver} driver against ${databaseHost(url)}.`,
    };
  }
  if (env.ALLOW_LOCAL_STORE_IN_PRODUCTION === "true") {
    return {
      name: "storage",
      status: "warn",
      detail:
        "No DATABASE_URL: falling back to JSON files on local disk. That is fine for " +
        "one process on one machine, and loses every plan and recorded track the " +
        "moment the container is replaced or a second instance starts.",
    };
  }
  return {
    name: "storage",
    status: "fail",
    detail:
      "No DATABASE_URL and no explicit local-store opt-in, so saving a plan, a " +
      "recorded track, or a guardian link will be refused. Attach a database.",
  };
}

/**
 * Whether the rate limiter can tell one client from another.
 *
 * Behind a proxy that does not set the header — or with the app not told to
 * trust it — every request shares one bucket, so a single busy client can
 * exhaust the quota that protects the outbound Overpass and elevation calls for
 * everyone. Not fatal, and worth saying.
 */
function proxyTrustCheck(env: Environment): ConfigCheck {
  if (env.TRUST_PROXY_HEADERS === "true") {
    return {
      name: "client-identity",
      status: "ok",
      detail: "X-Forwarded-For is trusted, so rate limits are per client.",
    };
  }
  return {
    name: "client-identity",
    status: "warn",
    detail:
      "TRUST_PROXY_HEADERS is not 'true', so every request shares one rate-limit " +
      "bucket. Set it when exactly one proxy in front of this app overwrites " +
      "X-Forwarded-For; leave it unset if nothing does.",
  };
}

/**
 * The native shell is a different origin from the API. Without an allowlist the
 * browser engine inside the app blocks every request before auth is consulted.
 * Only worth mentioning; the two built-in Capacitor origins cover the iOS app.
 */
function appOriginsCheck(env: Environment): ConfigCheck {
  const extra = (env.ALLOWED_APP_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  return {
    name: "app-origins",
    status: "ok",
    detail:
      extra.length > 0
        ? `Capacitor origins plus ${extra.length} configured origin${extra.length === 1 ? "" : "s"}.`
        : "Capacitor origins only, which is what the iOS shell needs.",
  };
}

/**
 * Keys whose absence degrades a feature rather than breaking the app. Named
 * individually so a deploy that meant to set one can see that it did not.
 */
const OPTIONAL_KEYS: Array<{ key: string; loses: string }> = [
  { key: "NPS_API_KEY", loses: "National Park Service alerts and campground detail" },
  { key: "RIDB_API_KEY", loses: "Recreation.gov campground detail" },
  { key: "OPENAI_API_KEY", loses: "the trail research brief and Pioneer observations" },
  { key: "AI_GATEWAY_API_KEY", loses: "Pioneer observations through Vercel AI Gateway" },
  { key: "TAVILY_API_KEY", loses: "web evidence behind the research brief" },
  { key: "NEXT_PUBLIC_MAPTILER_KEY", loses: "the online basemap" },
  { key: "ELEVATION_API_URL", loses: "a self-hosted elevation service (the public open-elevation instance is used instead)" },
];

function optionalKeysCheck(env: Environment): ConfigCheck {
  const missing = OPTIONAL_KEYS.filter(({ key }) => !env[key]);
  if (missing.length === 0) {
    return { name: "optional-keys", status: "ok", detail: "Every optional integration key is set." };
  }
  return {
    name: "optional-keys",
    status: "ok",
    detail: `Degraded but working without: ${missing.map((entry) => `${entry.key} (${entry.loses})`).join("; ")}.`,
  };
}

export function configReport(env: Environment = process.env): ConfigReport {
  const checks = [
    storageCheck(env),
    sessionSecretCheck(env),
    proxyTrustCheck(env),
    appOriginsCheck(env),
    optionalKeysCheck(env),
  ];
  const status: CheckStatus = checks.some((check) => check.status === "fail")
    ? "fail"
    : checks.some((check) => check.status === "warn")
      ? "warn"
      : "ok";
  return { status, checks };
}

/**
 * The report as lines for a log. Failures first, because the first screen of a
 * deployment log is the only part anyone reads.
 */
export function formatConfigReport(report: ConfigReport = configReport()): string[] {
  const rank: Record<CheckStatus, number> = { fail: 0, warn: 1, ok: 2 };
  const ordered = [...report.checks].sort((a, b) => rank[a.status] - rank[b.status]);
  const symbol: Record<CheckStatus, string> = { ok: "ok  ", warn: "WARN", fail: "FAIL" };
  return [
    report.status === "fail"
      ? "[config] This deployment cannot store user data. See the FAIL lines below."
      : report.status === "warn"
        ? "[config] Running with caveats:"
        : "[config] Configuration looks complete.",
    ...ordered.map((check) => `[config] ${symbol[check.status]} ${check.name}: ${check.detail}`),
  ];
}
