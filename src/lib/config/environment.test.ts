import { describe, expect, it } from "vitest";
import { configReport, formatConfigReport, type Environment } from "./environment";

const COMPLETE = {
  DATABASE_URL: "postgresql://user:hunter2@db.example.test:5432/klandagi",
  SESSION_SECRET: "0123456789abcdef0123456789abcdef",
  TRUST_PROXY_HEADERS: "true",
} satisfies Environment;

/**
 * The app could always boot into a state where it looked fine and stored
 * nothing: no DATABASE_URL and no explicit fallback meant every route that saves
 * a plan or a track answered 503, and the first person to find out was a hiker
 * at a trailhead. This is the check that has to notice instead.
 */
describe("a deployment says whether it can do its job", () => {
  it("passes a complete configuration", () => {
    const report = configReport(COMPLETE);
    expect(report.status).toBe("ok");
    expect(report.checks.every((check) => check.status === "ok")).toBe(true);
  });

  it("fails when there is nowhere to put a hiker's data", () => {
    const report = configReport({ SESSION_SECRET: COMPLETE.SESSION_SECRET } as Environment);
    expect(report.status).toBe("fail");
    const storage = report.checks.find((check) => check.name === "storage");
    expect(storage?.status).toBe("fail");
    expect(storage?.detail).toMatch(/Attach a database/);
  });

  it("treats the local-file fallback as a warning, not a pass", () => {
    const report = configReport({
      SESSION_SECRET: COMPLETE.SESSION_SECRET,
      ALLOW_LOCAL_STORE_IN_PRODUCTION: "true",
    } as Environment);
    expect(report.status).toBe("warn");
    expect(report.checks.find((check) => check.name === "storage")?.detail).toMatch(
      /loses every plan and recorded track/,
    );
  });

  it("fails without a session secret, because nothing can be signed", () => {
    const report = configReport({ ...COMPLETE, SESSION_SECRET: undefined });
    expect(report.status).toBe("fail");
    expect(report.checks.find((check) => check.name === "session-secret")?.status).toBe("fail");
  });

  it("warns about a session secret short enough to guess", () => {
    const report = configReport({ ...COMPLETE, SESSION_SECRET: "short" });
    expect(report.checks.find((check) => check.name === "session-secret")?.status).toBe("warn");
  });

  it("warns when every client shares one rate-limit bucket", () => {
    const report = configReport({ ...COMPLETE, TRUST_PROXY_HEADERS: undefined });
    expect(report.status).toBe("warn");
    expect(report.checks.find((check) => check.name === "client-identity")?.status).toBe("warn");
  });

  it("names the optional keys that are missing and what each one costs", () => {
    const detail = configReport(COMPLETE).checks.find(
      (check) => check.name === "optional-keys",
    )?.detail;
    expect(detail).toMatch(/NPS_API_KEY/);
    expect(detail).toMatch(/OPENAI_API_KEY \(the trail research brief and Pioneer observations\)/);
    expect(detail).toMatch(/AI_GATEWAY_API_KEY \(Pioneer observations through Vercel AI Gateway\)/);
  });
});

/**
 * A connection string is a credential and a session secret is the credential.
 * This report is printed into a deployment log and served, unauthenticated, from
 * /api/health.
 */
describe("nothing in the report is a secret", () => {
  it("never prints a password, a secret, or a whole connection string", () => {
    const serialized = JSON.stringify(configReport(COMPLETE)) + formatConfigReport(
      configReport(COMPLETE),
    ).join("\n");
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain(COMPLETE.SESSION_SECRET);
    expect(serialized).not.toContain("postgresql://");
  });

  it("names the database by host only, which is what an operator needs", () => {
    expect(configReport(COMPLETE).checks.find((check) => check.name === "storage")?.detail).toBe(
      "Using the postgres driver against db.example.test.",
    );
  });

  it("does not turn an unparseable URL into a crash", () => {
    const report = configReport({ ...COMPLETE, DATABASE_URL: "not a url" });
    expect(report.checks.find((check) => check.name === "storage")?.detail).toMatch(
      /an unparseable URL/,
    );
  });
});

/**
 * The first screen of a deployment log is the only part anyone reads.
 */
describe("the boot log leads with what is broken", () => {
  it("puts failures above warnings above passes", () => {
    const lines = formatConfigReport(
      configReport({ SESSION_SECRET: "short" } as Environment),
    );
    expect(lines[0]).toMatch(/cannot store user data/);
    const statuses = lines.slice(1).map((line) => line.split(" ")[1]);
    const rank = { FAIL: 0, WARN: 1, ok: 2 } as Record<string, number>;
    expect(statuses).toEqual([...statuses].sort((a, b) => rank[a] - rank[b]));
  });

  it("says so plainly when everything is set", () => {
    expect(formatConfigReport(configReport(COMPLETE))[0]).toMatch(/looks complete/);
  });
});
