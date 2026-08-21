import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("manual database setup", () => {
  it("documents every checked-in SQL migration", async () => {
    const root = process.cwd();
    const [readme, migrations] = await Promise.all([
      readFile(path.join(root, "README.md"), "utf8"),
      readdir(path.join(root, "drizzle")),
    ]);
    const databaseCommands = readme.match(
      /### Database \(optional\)\s+```bash\s+([\s\S]*?)```/,
    )?.[1];
    expect(databaseCommands, "README database setup block is missing").toBeDefined();

    for (const migration of migrations.filter((name) => name.endsWith(".sql"))) {
      expect(databaseCommands, `${migration} is missing from the manual psql setup`).toContain(
        `psql $DATABASE_URL -f drizzle/${migration}`,
      );
    }
  });
});
