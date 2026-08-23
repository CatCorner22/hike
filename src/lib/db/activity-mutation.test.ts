import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openActivityPointSelection } from "./activity-mutation";
import { activityPoints } from "./schema";

/**
 * Regression: the insert-select that saves a GPS point named six of the table's
 * seven columns — `id` was left to its column default, which an INSERT ... SELECT
 * does not apply. Drizzle validates the projection with
 * `haveSameKeys(table[Columns], select._.selectedFields)` and throws
 * "Insert select error: selected fields are not the same or are in a different
 * order compared to the table definition", so every POST to
 * /api/activities/:id/points answered 500 — the upload of a finished hike.
 *
 * It was invisible because every CI job runs on the JSON file fallback
 * (ALLOW_LOCAL_STORE_IN_PRODUCTION=true) and nothing ever pointed the suite at a
 * database. This asserts the parity Drizzle checks, without needing one.
 */
describe("the projection that writes a track point", () => {
  const point = {
    clientPointId: "device-1",
    lat: 37.7,
    lng: -119.5,
    elevation: 1200,
    recordedAt: "2026-08-20T10:00:00.000Z",
  };

  it("names every column of activity_points, in the table's own order", () => {
    expect(Object.keys(openActivityPointSelection(point))).toEqual(
      Object.keys(getTableColumns(activityPoints)),
    );
  });

  it("generates the primary key rather than relying on a default that will not fire", () => {
    const selection = openActivityPointSelection(point);
    expect(selection).toHaveProperty("id");
    expect(JSON.stringify(selection.id)).toContain("gen_random_uuid");
  });

  it("carries an absent client id and elevation as null rather than dropping the columns", () => {
    const sparse = openActivityPointSelection({ lat: 1, lng: 2, recordedAt: point.recordedAt });
    expect(Object.keys(sparse)).toEqual(Object.keys(getTableColumns(activityPoints)));
  });
});
