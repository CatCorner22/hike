import { describe, expect, it } from "vitest";
import { buildActivityGpxExport } from "./gpx-export";

const finishedAt = "2026-08-22T14:00:00.000Z";

describe("activity GPX export", () => {
  it("preserves every point timestamp and elevation", () => {
    const result = buildActivityGpxExport({
      name: "River & Ridge",
      endedAt: finishedAt,
      points: [
        { lat: 35.1, lng: -83.1, elevation: 1_234.5, recordedAt: "2026-08-22T12:00:00.000Z" },
        { lat: 35.2, lng: -83.2, elevation: null, recordedAt: "2026-08-22T12:00:05.000Z" },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filename).toBe("River-Ridge-activity.gpx");
    expect(result.pointCount).toBe(2);
    expect(result.gpx).toContain("<ele>1234.5</ele>");
    expect(result.gpx).toContain("<time>2026-08-22T12:00:00.000Z</time>");
    expect(result.gpx).toContain("<time>2026-08-22T12:00:05.000Z</time>");
  });

  it("enforces a finished session", () => {
    expect(buildActivityGpxExport({ name: "Active", endedAt: null, points: [] })).toEqual({
      ok: false,
      status: 409,
      error: "Finish the activity before exporting its GPX track.",
    });
  });

  it("refuses an empty finished track", () => {
    expect(buildActivityGpxExport({ name: "Empty", endedAt: finishedAt, points: [] })).toMatchObject({
      ok: false,
      status: 422,
    });
  });

  it("fails closed instead of silently dropping a corrupt point", () => {
    expect(buildActivityGpxExport({
      name: "Corrupt",
      endedAt: finishedAt,
      points: [{ lat: Number.NaN, lng: -83, recordedAt: finishedAt }],
    })).toMatchObject({ ok: false, status: 422 });
  });
});
