import { describe, expect, it } from "vitest";
import { resolveDatabaseDriver } from "./index";

/**
 * `@neondatabase/serverless`'s `neon()` is not a Postgres client — it posts SQL
 * to `https://<host>/sql`. Picking it for an ordinary Postgres fails outright,
 * while picking `pg` for Neon still works, because Neon speaks the wire protocol
 * like everyone else. So the guess is deliberately asymmetric: only a host we
 * can positively identify as Neon gets the HTTP driver.
 */
describe("choosing a database driver", () => {
  it("uses plain Postgres for hosts that are not Neon", () => {
    for (const url of [
      "postgresql://user:pw@127.0.0.1:5432/klandagi",
      "postgres://user:pw@db.example.com:5432/klandagi?sslmode=require",
      "postgresql://user:pw@helium.replit.dev/klandagi",
    ]) {
      expect(resolveDatabaseDriver(url, undefined)).toBe("postgres");
    }
  });

  it("uses the HTTP driver for a Neon endpoint", () => {
    expect(
      resolveDatabaseDriver("postgresql://u:p@ep-cool-1.us-east-2.aws.neon.tech/db", undefined),
    ).toBe("neon-http");
    // Neon's pooled endpoint is still Neon.
    expect(
      resolveDatabaseDriver("postgresql://u:p@ep-cool-1-pooler.us-east-2.aws.neon.tech/db", undefined),
    ).toBe("neon-http");
  });

  it("does not match a host that merely mentions neon", () => {
    // "neon.tech" has to be the actual domain, not a substring someone's own
    // hostname happens to contain.
    expect(resolveDatabaseDriver("postgresql://u:p@neon.tech.example.com/db", undefined)).toBe("postgres");
    expect(resolveDatabaseDriver("postgresql://u:p@my-neon-db.example.com/db", undefined)).toBe("postgres");
  });

  it("lets an operator override the guess", () => {
    const neonUrl = "postgresql://u:p@ep-1.aws.neon.tech/db";
    expect(resolveDatabaseDriver(neonUrl, "postgres")).toBe("postgres");
    expect(resolveDatabaseDriver("postgresql://u:p@127.0.0.1/db", "neon-http")).toBe("neon-http");
    // A meaningless value falls through to the guess rather than being obeyed.
    expect(resolveDatabaseDriver(neonUrl, "sqlite")).toBe("neon-http");
  });

  it("never lets an unparseable URL pick the driver that cannot recover", () => {
    expect(resolveDatabaseDriver("not a url", undefined)).toBe("postgres");
    expect(resolveDatabaseDriver(undefined, undefined)).toBe("postgres");
  });
});
