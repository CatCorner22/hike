"use client";

import { useEffect, useId, useRef, useState } from "react";
import { format } from "date-fns";
import { Download, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  NavTrackStorageError,
  deleteNavSession,
  exportNavSession,
  listNavSessions,
  serializeNavSessionExport,
  type NavTrackSessionSummary,
} from "@/lib/offline/nav-track";
import { breadcrumbGpx, downloadTextFile, safeFilename } from "@/lib/safety/field";

export type CompletedTrackLoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; tracks: NavTrackSessionSummary[] };

type TrackNotice = { tone: "success" | "error"; message: string } | null;

interface CompletedNavigationTrackListProps {
  state: CompletedTrackLoadState;
  notice: TrackNotice;
  confirmDeleteId: string | null;
  workingId: string | null;
  onRetry: () => void;
  onExportGpx: (track: NavTrackSessionSummary) => void;
  onExportJson: (track: NavTrackSessionSummary) => void;
  onRequestDelete: (sessionId: string) => void;
  onCancelDelete: () => void;
  onConfirmDelete: (track: NavTrackSessionSummary) => void;
}

/** A final defensive boundary: active breadcrumb sessions must never appear here. */
export function finishedTrackSummaries(
  sessions: readonly NavTrackSessionSummary[],
): NavTrackSessionSummary[] {
  return sessions.filter((session) => session.status === "finished");
}

function displayDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? format(date, "MMM d, yyyy · h:mm a")
    : "Date unavailable";
}

function trackFilename(track: NavTrackSessionSummary): string {
  const timestamp = Number.isFinite(Date.parse(track.startedAt))
    ? safeFilename(track.startedAt.replace(/\.\d{3}Z$/, "Z").replace(/[:]/g, "-"))
    : "undated";
  return `${safeFilename(track.name)}-${timestamp}-navigation-track.json`;
}

function trackGpxFilename(track: NavTrackSessionSummary): string {
  const timestamp = Number.isFinite(Date.parse(track.startedAt))
    ? safeFilename(track.startedAt.replace(/\.\d{3}Z$/, "Z").replace(/[:]/g, "-"))
    : "undated";
  return `${safeFilename(track.name)}-${timestamp}-navigation-track.gpx`;
}

function assertFinishedTrack(track: NavTrackSessionSummary): void {
  if (track.status !== "finished") {
    throw new NavTrackStorageError(
      "invalid-input",
      "Only a completed navigation track can be exported or deleted here.",
    );
  }
}

export async function exportFinishedNavigationTrack(
  track: NavTrackSessionSummary,
  dependencies: {
    serialize?: typeof serializeNavSessionExport;
    download?: typeof downloadTextFile;
  } = {},
): Promise<{ filename: string }> {
  assertFinishedTrack(track);
  const text = await (dependencies.serialize ?? serializeNavSessionExport)(track.id);
  const filename = trackFilename(track);
  (dependencies.download ?? downloadTextFile)(filename, text, "application/json");
  return { filename };
}

export async function exportFinishedNavigationTrackGpx(
  track: NavTrackSessionSummary,
  dependencies: {
    read?: typeof exportNavSession;
    download?: typeof downloadTextFile;
  } = {},
): Promise<{ filename: string; pointCount: number }> {
  assertFinishedTrack(track);
  const exported = await (dependencies.read ?? exportNavSession)(track.id);
  if (exported.session.status !== "finished") {
    throw new NavTrackStorageError(
      "invalid-input",
      "Only a completed navigation track can be exported here.",
    );
  }
  if (exported.points.length === 0) {
    throw new NavTrackStorageError("invalid-input", "This completed track has no GPS points to export.");
  }
  const gpx = breadcrumbGpx(track.name, exported.points.map((point) => ({
    lat: point.lat,
    lng: point.lng,
    altitude: point.altitude,
    recordedAt: point.recordedAt,
  })));
  const filename = trackGpxFilename(track);
  (dependencies.download ?? downloadTextFile)(filename, gpx, "application/gpx+xml");
  return { filename, pointCount: exported.points.length };
}

export async function deleteFinishedNavigationTrack(
  track: NavTrackSessionSummary,
  dependencies: {
    remove?: typeof deleteNavSession;
    list?: typeof listNavSessions;
  } = {},
): Promise<{ deleted: boolean; tracks: NavTrackSessionSummary[] }> {
  assertFinishedTrack(track);
  const deleted = await (dependencies.remove ?? deleteNavSession)(track.id);
  const sessions = await (dependencies.list ?? listNavSessions)({ status: "finished" });
  return { deleted, tracks: finishedTrackSummaries(sessions) };
}

interface CompletedNavigationTrackItemProps {
  track: NavTrackSessionSummary;
  confirming: boolean;
  working: boolean;
  onExportGpx: (track: NavTrackSessionSummary) => void;
  onExportJson: (track: NavTrackSessionSummary) => void;
  onRequestDelete: (sessionId: string) => void;
  onCancelDelete: () => void;
  onConfirmDelete: (track: NavTrackSessionSummary) => void;
}

function CompletedNavigationTrackItem({
  track,
  confirming,
  working,
  onExportGpx,
  onExportJson,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: CompletedNavigationTrackItemProps) {
  const warningId = useId();
  const deleteButtonRef = useRef<HTMLButtonElement | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const wasConfirming = useRef(false);

  useEffect(() => {
    if (confirming && !wasConfirming.current) confirmButtonRef.current?.focus();
    if (!confirming && wasConfirming.current) deleteButtonRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  return (
    <li className="space-y-3 rounded-lg border p-3">
      <div className="min-w-0">
        <p className="break-words font-medium">{track.name}</p>
        <p className="text-xs text-muted-foreground">
          Started {displayDate(track.startedAt)} · {track.pointCount.toLocaleString()} GPS
          {track.pointCount === 1 ? " point" : " points"}
        </p>
        {track.finishedAt && (
          <p className="text-xs text-muted-foreground">
            Finished {displayDate(track.finishedAt)}
          </p>
        )}
      </div>

      {confirming ? (
        <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
          <p id={warningId} className="text-sm">
            Permanently delete “{track.name}” and all {track.pointCount.toLocaleString()} saved GPS{" "}
            {track.pointCount === 1 ? "point" : "points"} from this device?
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              ref={confirmButtonRef}
              type="button"
              size="sm"
              variant="destructive"
              aria-describedby={warningId}
              disabled={working}
              onClick={() => onConfirmDelete(track)}
            >
              <Trash2 className="mr-2 size-4" />
              {working ? "Deleting…" : "Confirm delete"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={working}
              onClick={onCancelDelete}
            >
              <X className="mr-2 size-4" />
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={working}
            onClick={() => onExportGpx(track)}
          >
            <Download className="mr-2 size-4" />
            {working ? "Exporting…" : "Export GPX"}
          </Button>
          <details className="self-center text-xs text-muted-foreground">
            <summary className="cursor-pointer">Backup / technical export</summary>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="mt-1"
              disabled={working}
              onClick={() => onExportJson(track)}
            >
              <Download className="mr-2 size-4" />
              Export JSON backup
            </Button>
          </details>
          <Button
            ref={deleteButtonRef}
            type="button"
            size="sm"
            variant="ghost"
            disabled={working}
            onClick={() => onRequestDelete(track.id)}
          >
            <Trash2 className="mr-2 size-4" />
            Delete
          </Button>
        </div>
      )}
    </li>
  );
}

export function CompletedNavigationTrackList({
  state,
  notice,
  confirmDeleteId,
  workingId,
  onRetry,
  onExportGpx,
  onExportJson,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: CompletedNavigationTrackListProps) {
  return (
    <section aria-labelledby="completed-navigation-tracks-heading">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id="completed-navigation-tracks-heading" tabIndex={-1}>
              Completed navigation tracks
            </h2>
          </CardTitle>
          <CardDescription>
            Breadcrumbs from finished navigation sessions are saved only in this
            browser on this device. GPX and optional JSON backup exports stay on this device;
            nothing is uploaded.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {state.status === "loading" ? (
            <p role="status" className="text-sm text-muted-foreground">
              Checking this device for completed navigation tracks…
            </p>
          ) : state.status === "error" ? (
            <div className="space-y-2" role="alert">
              <p className="text-sm text-destructive">{state.message}</p>
              <Button type="button" size="sm" variant="outline" onClick={onRetry}>
                Retry
              </Button>
            </div>
          ) : state.tracks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No completed navigation tracks are saved on this device.
            </p>
          ) : (
            <ul className="space-y-3">
              {state.tracks.map((track) => (
                <CompletedNavigationTrackItem
                  key={track.id}
                  track={track}
                  confirming={confirmDeleteId === track.id}
                  working={workingId === track.id}
                  onExportGpx={onExportGpx}
                  onExportJson={onExportJson}
                  onRequestDelete={onRequestDelete}
                  onCancelDelete={onCancelDelete}
                  onConfirmDelete={onConfirmDelete}
                />
              ))}
            </ul>
          )}

          <div aria-live="polite" aria-atomic="true">
            {notice && (
              <p
                className={`mt-3 text-sm ${
                  notice.tone === "error" ? "text-destructive" : "text-muted-foreground"
                }`}
              >
                {notice.message}
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

function storageMessage(error: unknown): string {
  return error instanceof NavTrackStorageError
    ? error.message
    : "Completed navigation tracks could not be read on this device.";
}

export function CompletedNavigationTracks() {
  const [state, setState] = useState<CompletedTrackLoadState>({ status: "loading" });
  const [notice, setNotice] = useState<TrackNotice>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);

  async function loadTracks() {
    setState({ status: "loading" });
    try {
      const sessions = await listNavSessions({ status: "finished" });
      setState({ status: "ready", tracks: finishedTrackSummaries(sessions) });
    } catch (error) {
      setState({ status: "error", message: storageMessage(error) });
    }
  }

  useEffect(() => {
    let cancelled = false;
    void listNavSessions({ status: "finished" })
      .then((sessions) => {
        if (!cancelled) {
          setState({ status: "ready", tracks: finishedTrackSummaries(sessions) });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: "error", message: storageMessage(error) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function exportTrackGpx(track: NavTrackSessionSummary) {
    if (track.status !== "finished" || workingId !== null) return;
    setWorkingId(track.id);
    setNotice(null);
    try {
      await exportFinishedNavigationTrackGpx(track);
      setNotice({
        tone: "success",
        message: `Downloaded “${track.name}” as GPX. Nothing was uploaded.`,
      });
    } catch (error) {
      setNotice({ tone: "error", message: `${storageMessage(error)} Nothing was exported.` });
    } finally {
      setWorkingId(null);
    }
  }

  async function exportTrackJson(track: NavTrackSessionSummary) {
    if (track.status !== "finished" || workingId !== null) return;
    setWorkingId(track.id);
    setNotice(null);
    try {
      await exportFinishedNavigationTrack(track);
      setNotice({
        tone: "success",
        message: `Downloaded “${track.name}” as a JSON backup. Nothing was uploaded.`,
      });
    } catch (error) {
      setNotice({ tone: "error", message: `${storageMessage(error)} Nothing was exported.` });
    } finally {
      setWorkingId(null);
    }
  }

  async function removeTrack(track: NavTrackSessionSummary) {
    if (track.status !== "finished" || workingId !== null) return;
    setWorkingId(track.id);
    setNotice(null);
    try {
      const { deleted, tracks } = await deleteFinishedNavigationTrack(track);
      setState({ status: "ready", tracks });
      setConfirmDeleteId(null);
      setNotice({
        tone: "success",
        message: deleted
          ? `Permanently deleted “${track.name}” from this device.`
          : `“${track.name}” was already absent from this device.`,
      });
      window.requestAnimationFrame(() => {
        document.getElementById("completed-navigation-tracks-heading")?.focus();
      });
    } catch (error) {
      setNotice({ tone: "error", message: storageMessage(error) });
    } finally {
      setWorkingId(null);
    }
  }

  return (
    <CompletedNavigationTrackList
      state={state}
      notice={notice}
      confirmDeleteId={confirmDeleteId}
      workingId={workingId}
      onRetry={() => void loadTracks()}
      onExportGpx={(track) => void exportTrackGpx(track)}
      onExportJson={(track) => void exportTrackJson(track)}
      onRequestDelete={(sessionId) => {
        setNotice(null);
        setConfirmDeleteId(sessionId);
      }}
      onCancelDelete={() => setConfirmDeleteId(null)}
      onConfirmDelete={(track) => void removeTrack(track)}
    />
  );
}
