import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  CompletedNavigationTrackList,
  deleteFinishedNavigationTrack,
  exportFinishedNavigationTrack,
  exportFinishedNavigationTrackGpx,
  finishedTrackSummaries,
  type CompletedTrackLoadState,
} from "./completed-navigation-tracks";
import type { NavTrackSessionSummary } from "@/lib/offline/nav-track";

const finished: NavTrackSessionSummary = {
  id: "finished-1",
  packId: "private-pack",
  name: "River Loop",
  startedAt: "2026-08-22T12:00:00.000Z",
  status: "finished",
  finishedAt: "2026-08-22T13:30:00.000Z",
  pointCount: 412,
  nextSequence: 412,
  lastPointAt: "2026-08-22T13:29:59.000Z",
};

const active: NavTrackSessionSummary = {
  ...finished,
  id: "active-1",
  name: "Still hiking",
  status: "active",
  finishedAt: undefined,
};

function render(
  state: CompletedTrackLoadState,
  options: { confirmDeleteId?: string | null; workingId?: string | null } = {},
) {
  return renderToStaticMarkup(
    createElement(CompletedNavigationTrackList, {
      state,
      notice: null,
      confirmDeleteId: options.confirmDeleteId ?? null,
      workingId: options.workingId ?? null,
      onRetry: vi.fn(),
      onExportGpx: vi.fn(),
      onExportJson: vi.fn(),
      onRequestDelete: vi.fn(),
      onCancelDelete: vi.fn(),
      onConfirmDelete: vi.fn(),
    }),
  );
}

describe("completed navigation track management", () => {
  it("defensively excludes active navigation sessions", () => {
    expect(finishedTrackSummaries([active, finished])).toEqual([finished]);
  });

  it("renders distinct loading, error, and empty states", () => {
    expect(render({ status: "loading" })).toContain(
      "Checking this device for completed navigation tracks",
    );

    const error = render({ status: "error", message: "Storage unavailable" });
    expect(error).toContain('role="alert"');
    expect(error).toContain("Storage unavailable");
    expect(error).toContain("Retry");

    expect(render({ status: "ready", tracks: [] })).toContain(
      "No completed navigation tracks are saved on this device",
    );
  });

  it("shows accessible export and delete controls without leaking storage ids", () => {
    const html = render({ status: "ready", tracks: [finished] });

    expect(html).toContain("River Loop");
    expect(html).toContain("412 GPS points");
    expect(html).toContain("Export GPX");
    expect(html).toContain("Export JSON backup");
    expect(html).toContain("Delete");
    expect(html).toContain("nothing is uploaded");
    expect(html).not.toContain("private-pack");
    expect(html).not.toContain("finished-1");
  });

  it("requires a second explicit action before permanent deletion", () => {
    const html = render(
      { status: "ready", tracks: [finished] },
      { confirmDeleteId: finished.id },
    );

    expect(html).toContain("Permanently delete");
    expect(html).toContain("Confirm delete");
    expect(html).toContain("Cancel");
    expect(html).toMatch(/aria-describedby="[^"]+"/);
    expect(html).not.toContain("finished-1");
    expect(html).not.toContain("Export GPX");
  });

  it("exports every finished navigation point as GPX with time and elevation", async () => {
    const read = vi.fn(async () => ({
      format: "klandagi-nav-track" as const,
      version: 2 as const,
      exportedAt: "2026-08-22T14:00:00.000Z",
      session: finished,
      points: [
        {
          pointId: "p1",
          sessionId: finished.id,
          sequence: 0,
          lat: 35,
          lng: -83,
          altitude: 1000,
          recordedAt: "2026-08-22T12:00:00.000Z",
        },
        {
          pointId: "p2",
          sessionId: finished.id,
          sequence: 1,
          lat: 35.1,
          lng: -83.1,
          recordedAt: "2026-08-22T12:00:05.000Z",
        },
      ],
    }));
    const download = vi.fn();

    const result = await exportFinishedNavigationTrackGpx(finished, { read, download });

    expect(result.pointCount).toBe(2);
    expect(result.filename).toMatch(/navigation-track\.gpx$/);
    const gpx = download.mock.calls[0][1] as string;
    expect(gpx).toContain("<ele>1000</ele>");
    expect(gpx).toContain("<time>2026-08-22T12:00:05.000Z</time>");
    expect(download.mock.calls[0][2]).toBe("application/gpx+xml");
  });

  it("rejects active and empty navigation GPX exports", async () => {
    const read = vi.fn();
    await expect(exportFinishedNavigationTrackGpx(active, { read })).rejects.toMatchObject({
      code: "invalid-input",
    });
    expect(read).not.toHaveBeenCalled();

    await expect(exportFinishedNavigationTrackGpx(finished, {
      read: vi.fn(async () => ({
        format: "klandagi-nav-track" as const,
        version: 2 as const,
        exportedAt: "2026-08-22T14:00:00.000Z",
        session: finished,
        points: [],
      })),
    })).rejects.toMatchObject({ code: "invalid-input" });
  });

  it("exports only finished tracks through the expected JSON download contract", async () => {
    const serialize = vi.fn(async () => "{\"track\":true}");
    const download = vi.fn();

    const result = await exportFinishedNavigationTrack(finished, { serialize, download });

    expect(serialize).toHaveBeenCalledWith(finished.id);
    expect(download).toHaveBeenCalledWith(
      result.filename,
      "{\"track\":true}",
      "application/json",
    );
    expect(result.filename).toMatch(/^River-Loop-.*-navigation-track\.json$/);
    expect(result.filename).not.toContain(finished.id);
    await expect(
      exportFinishedNavigationTrack(active, { serialize, download }),
    ).rejects.toMatchObject({ code: "invalid-input" });
    expect(serialize).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledTimes(1);
  });

  it("deletes the chosen finished session, refreshes, and still filters active sessions", async () => {
    const nextFinished = { ...finished, id: "finished-2", name: "Next track" };
    const remove = vi.fn(async () => true);
    const list = vi.fn(async () => [active, nextFinished]);

    const result = await deleteFinishedNavigationTrack(finished, { remove, list });

    expect(remove).toHaveBeenCalledWith(finished.id);
    expect(list).toHaveBeenCalledWith({ status: "finished" });
    expect(result).toEqual({ deleted: true, tracks: [nextFinished] });
  });
});
