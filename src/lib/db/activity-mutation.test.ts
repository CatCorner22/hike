import { describe, expect, it } from "vitest";
import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { ACTIVITY_POINT_COLUMNS, insertActivityPointBatch } from "./activity-mutation";
import { activityPoints } from "./schema";

/**
 * The defect this guards is not a type error and never was.
 *
 * Drizzle's `insert().select()` checks `haveSameKeys(table[Columns],
 * select._.selectedFields)` at runtime and throws when the projection misses a
 * column. The projection missed `id`, so every `POST /api/activities/:id/points`
 * answered 500 — the upload of a finished hike, on every deployment this app has
 * ever had. It was invisible because every CI job ran on the JSON fallback.
 *
 * The write is a single batched statement now, which names its columns in SQL
 * text rather than in a Drizzle projection. Same failure mode, same guard: the
 * list has to match the table.
 */
describe("the GPS-point writer names every column of its table", () => {
  const tableColumns = getTableConfig(activityPoints).columns.map((column) => column.name);

  it("matches activity_points exactly, in order", () => {
    expect([...ACTIVITY_POINT_COLUMNS]).toEqual(tableColumns);
  });

  it("names those same columns in both halves of the INSERT ... SELECT", async () => {
    // Render exactly what Postgres receives, rather than inspecting the builder.
    let captured = "";
    const dialect = new PgDialect();
    const db = {
      async execute(query: SQL) {
        captured = dialect.sqlToQuery(query).sql;
        return { rows: [] };
      },
    };
    await insertActivityPointBatch(
      db as Parameters<typeof insertActivityPointBatch>[0],
      "activity-1",
      "owner-1",
      [{ lat: 1, lng: 2, recordedAt: "2026-01-01T00:00:00.000Z" }],
    );
    for (const column of tableColumns) {
      expect(captured, `${column} missing from the insert`).toContain(column);
    }
    // The open-activity predicate is what stops a point landing on a finished
    // track when another instance finalizes mid-flight. It belongs in the
    // statement, not in a separate read.
    expect(captured).toContain("ended_at is null");
    expect(captured).toContain("on conflict do nothing");
  });

  it("sends nothing at all for an empty batch", async () => {
    let called = false;
    const db = { async execute() { called = true; return { rows: [] }; } };
    const result = await insertActivityPointBatch(
      db as Parameters<typeof insertActivityPointBatch>[0],
      "activity-1",
      "owner-1",
      [],
    );
    expect(result).toEqual([]);
    expect(called).toBe(false);
  });

  it("types the first VALUES row, which is where Postgres reads the column types", async () => {
    let captured = "";
    const dialect = new PgDialect();
    const db = {
      async execute(query: SQL) { captured = dialect.sqlToQuery(query).sql; return { rows: [] }; },
    };
    await insertActivityPointBatch(
      db as Parameters<typeof insertActivityPointBatch>[0],
      "a",
      "o",
      [
        { lat: 1, lng: 2, recordedAt: "2026-01-01T00:00:00.000Z" },
        { lat: 3, lng: 4, recordedAt: "2026-01-01T00:00:01.000Z" },
      ],
    );
    // Without the casts Postgres answers "could not determine data type of
    // parameter", which is a 500 on every batch upload.
    expect(captured).toContain("double precision");
    expect(captured).toContain("::timestamp");
  });
});
