"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Download, Edit3, MapPin, Trash2, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  downloadBlobFile,
  EVERYDAY_WAYPOINT_KINDS,
  prepareFieldPhoto,
  waypointKindLabel,
  waypointsGeoJson,
  type EverydayWaypointKind,
} from "@/lib/safety/field-capture";
import { safeFilename } from "@/lib/safety/field";
import { saveTextFile } from "@/lib/platform/save-file";
import type { PositionSource } from "@/lib/safety/emergency";
import {
  deleteFieldPhoto,
  deleteWaypoint,
  readFieldPhotos,
  readWaypoints,
  restoreWaypoint,
  saveFieldPhoto,
  saveWaypoint,
  updateWaypoint,
  type FieldPhoto,
  type SafetyWaypoint,
} from "@/lib/safety/profile";

interface FieldCaptureProps {
  packId: string;
  trailName: string;
  lat?: number;
  lng?: number;
  accuracyM?: number;
  stale?: boolean;
  recordedAt?: number;
  positionSource?: PositionSource;
  waypoints: SafetyWaypoint[];
  onWaypointsChange: (waypoints: SafetyWaypoint[]) => void;
}

type Status = { tone: "working" | "saved" | "error"; text: string } | null;

function displayTime(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString([], { dateStyle: "short", timeStyle: "short" })
    : "time unavailable";
}

function PhotoPreview({ photo }: { photo: FieldPhoto }) {
  const [url] = useState(() => URL.createObjectURL(photo.blob));
  useEffect(() => {
    return () => URL.revokeObjectURL(url);
  }, [url]);
  // The URL points to a local IndexedDB blob, never a remote asset.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="Saved field photo" className="h-16 w-20 rounded object-cover" />;
}

export function FieldCapture({
  packId,
  trailName,
  lat,
  lng,
  accuracyM,
  stale = false,
  recordedAt,
  positionSource,
  waypoints,
  onWaypointsChange,
}: FieldCaptureProps) {
  const [kind, setKind] = useState<EverydayWaypointKind>("note");
  const [note, setNote] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photos, setPhotos] = useState<FieldPhoto[]>([]);
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editKind, setEditKind] = useState<SafetyWaypoint["kind"]>("note");
  const [editNote, setEditNote] = useState("");
  const [deleted, setDeleted] = useState<{ waypoint: SafetyWaypoint; photos: FieldPhoto[] } | null>(null);
  const [retryPhoto, setRetryPhoto] = useState<{ file: File; waypoint: SafetyWaypoint } | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const effectiveSource: PositionSource = positionSource ?? (stale ? "lastKnown" : "gps");
  const markLabel =
    effectiveSource === "deadReckon"
      ? "Mark estimated place"
      : effectiveSource === "lastKnown"
        ? "Mark last known place"
        : "Mark this place";

  useEffect(() => {
    let active = true;
    void Promise.all([readWaypoints(packId), readFieldPhotos(packId)]).then(([pointsResult, photosResult]) => {
      if (!active) return;
      if (pointsResult.ok) onWaypointsChange(pointsResult.waypoints);
      else setStatus({ tone: "error", text: pointsResult.message });
      if (photosResult.ok) setPhotos(photosResult.photos);
      else if (pointsResult.ok) setStatus({ tone: "error", text: photosResult.message });
    });
    return () => {
      active = false;
    };
  }, [packId, onWaypointsChange]);

  async function attachPhoto(file: File, waypoint: SafetyWaypoint): Promise<boolean> {
    try {
      setStatus({ tone: "working", text: "Making a private, smaller photo copy on this phone…" });
      const prepared = await prepareFieldPhoto(file);
      const result = await saveFieldPhoto({
        packId,
        waypointId: waypoint.id,
        width: prepared.width,
        height: prepared.height,
        blob: prepared.blob,
      });
      if (!result.ok) {
        setRetryPhoto({ file, waypoint });
        setStatus({ tone: "error", text: `Place saved, but photo not saved. ${result.message}` });
        return false;
      }
      setPhotos((current) => [result.photo, ...current]);
      setRetryPhoto(null);
      return true;
    } catch (error) {
      setRetryPhoto({ file, waypoint });
      setStatus({
        tone: "error",
        text: `Place saved, but photo not saved. ${error instanceof Error ? error.message : "The photo could not be prepared."}`,
      });
      return false;
    }
  }

  async function markPlace() {
    if (lat == null || lng == null || busy) return;
    setBusy(true);
    setDeleted(null);
    setRetryPhoto(null);
    setStatus({ tone: "working", text: "Saving this place on your phone…" });
    const result = await saveWaypoint(packId, kind, lat, lng, note, {
      accuracyM,
      source: effectiveSource,
      recordedAt,
    });
    if (!result.ok) {
      setStatus({ tone: "error", text: result.message });
      setBusy(false);
      return;
    }
    onWaypointsChange([result.waypoint, ...waypoints.filter((point) => point.id !== result.waypoint.id)]);

    const photoSaved = photoFile ? await attachPhoto(photoFile, result.waypoint) : true;
    setNote("");
    if (photoSaved) {
      setPhotoFile(null);
      if (fileInput.current) fileInput.current.value = "";
      setStatus({
        tone: "saved",
        text: photoFile
          ? "Place and private photo saved and checked on this phone."
          : "Place saved and checked on this phone.",
      });
    }
    setBusy(false);
  }

  function beginEdit(point: SafetyWaypoint) {
    setEditingId(point.id);
    setEditKind(point.kind);
    setEditNote(point.note ?? "");
    setStatus(null);
  }

  async function saveEdit(point: SafetyWaypoint) {
    if (busy) return;
    setBusy(true);
    setStatus({ tone: "working", text: "Saving changes…" });
    const result = await updateWaypoint(packId, point.id, { kind: editKind, note: editNote });
    if (!result.ok) {
      setStatus({ tone: "error", text: result.message });
    } else {
      onWaypointsChange(waypoints.map((item) => (item.id === point.id ? result.waypoint : item)));
      setEditingId(null);
      setStatus({ tone: "saved", text: "Changes saved and checked on this phone." });
    }
    setBusy(false);
  }

  async function removeWaypoint(point: SafetyWaypoint) {
    if (busy) return;
    setBusy(true);
    setStatus({ tone: "working", text: "Deleting this saved place…" });
    const result = await deleteWaypoint(packId, point.id);
    if (!result.ok) {
      setStatus({ tone: "error", text: result.message });
    } else {
      onWaypointsChange(waypoints.filter((item) => item.id !== point.id));
      setPhotos((current) => current.filter((photo) => photo.waypointId !== point.id));
      setDeleted({ waypoint: result.waypoint, photos: result.photos });
      setEditingId(null);
      setStatus({ tone: "saved", text: "Place deleted. You can undo this now." });
    }
    setBusy(false);
  }

  async function undoDelete() {
    if (!deleted || busy) return;
    setBusy(true);
    setStatus({ tone: "working", text: "Restoring the place…" });
    const result = await restoreWaypoint(deleted.waypoint, deleted.photos);
    if (!result.ok) {
      setStatus({ tone: "error", text: result.message });
    } else {
      onWaypointsChange([result.waypoint, ...waypoints]);
      setPhotos((current) => [...deleted.photos, ...current]);
      setDeleted(null);
      setStatus({ tone: "saved", text: "Place restored and checked on this phone." });
    }
    setBusy(false);
  }

  async function exportPlaces() {
    setStatus({ tone: "working", text: "Reading saved places from this phone…" });
    const result = await readWaypoints(packId);
    if (!result.ok) {
      setStatus({ tone: "error", text: `${result.message} Nothing was exported.` });
      return;
    }
    if (result.waypoints.length === 0) {
      setStatus({ tone: "error", text: "There are no saved places to export." });
      return;
    }
    const saved = await saveTextFile(
      `${safeFilename(trailName)}-saved-places.geojson`,
      waypointsGeoJson(trailName, result.waypoints),
      "application/geo+json",
    );
    if (saved) {
      setStatus({ tone: "saved", text: `${result.waypoints.length} saved place${result.waypoints.length === 1 ? "" : "s"} exported.` });
    } else {
      setStatus({ tone: "error", text: "The phone could not export your saved places." });
    }
  }

  async function removePhoto(photo: FieldPhoto) {
    setStatus({ tone: "working", text: "Deleting photo…" });
    if (!(await deleteFieldPhoto(packId, photo.id))) {
      setStatus({ tone: "error", text: "The phone could not verify that the photo was deleted." });
      return;
    }
    setPhotos((current) => current.filter((item) => item.id !== photo.id));
    setStatus({ tone: "saved", text: "Photo deleted from this phone." });
  }

  return (
    <section className="space-y-3 rounded-lg border-2 border-primary/40 bg-primary/5 p-3" aria-labelledby="mark-this-place-heading">
      <div>
        <h3 id="mark-this-place-heading" className="flex items-center gap-2 font-semibold">
          <MapPin className="size-5 text-primary" />
          Mark this place
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {effectiveSource === "deadReckon"
            ? "Saves your pace-and-heading estimate, not a live GPS fix."
            : effectiveSource === "lastKnown"
              ? "GPS is not live. This saves the last known position and labels it that way."
              : "Saves your current GPS position on this phone for this route."}
          {/*
            A non-positive accuracy is how CoreLocation and the W3C Geolocation
            API both say "no valid estimate". Rendering it as "about 0 m" turned
            the absence of a measurement into a claim of a perfect one, on the
            screen where somebody is recording a place they may have to find
            again in the dark.
          */}
          {accuracyM != null && Number.isFinite(accuracyM) && accuracyM > 0
            ? ` Reported accuracy is about ${Math.round(accuracyM)} m.`
            : " No accuracy estimate came with this fix."}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {EVERYDAY_WAYPOINT_KINDS.map((option) => (
          <Button
            key={option.value}
            type="button"
            size="sm"
            variant={kind === option.value ? "default" : "outline"}
            onClick={() => setKind(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>

      <div className="space-y-1">
        <Label htmlFor={`place-note-${packId}`}>Note (optional)</Label>
        <Input
          id={`place-note-${packId}`}
          value={note}
          maxLength={240}
          placeholder="Example: washed-out bridge"
          onChange={(event) => setNote(event.target.value)}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor={`place-photo-${packId}`} className="flex items-center gap-2">
          <Camera className="size-4" /> Photo (optional)
        </Label>
        <Input
          ref={fileInput}
          id={`place-photo-${packId}`}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(event) => setPhotoFile(event.target.files?.[0] ?? null)}
        />
        <p className="text-[11px] text-muted-foreground">
          The app makes a smaller JPEG on this device and leaves out embedded GPS and camera metadata. It is not uploaded.
        </p>
      </div>

      <Button className="min-h-12 w-full text-base" disabled={lat == null || lng == null || busy} onClick={() => void markPlace()}>
        <MapPin className="mr-2 size-5" />
        {busy ? "Working…" : markLabel}
      </Button>

      <div aria-live="polite" aria-atomic="true">
        {status && (
          <div
            className={`rounded-md border p-2 text-sm ${
              status.tone === "error"
                ? "border-destructive/50 bg-destructive/10 text-destructive"
                : status.tone === "saved"
                  ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
                  : "bg-muted text-muted-foreground"
            }`}
          >
            <p className="flex items-start gap-2">
              {status.tone === "saved" && <CheckCircle2 className="mt-0.5 size-4 shrink-0" />}
              <span>{status.text}</span>
            </p>
            {retryPhoto && (
              <Button
                className="mt-2"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const saved = await attachPhoto(retryPhoto.file, retryPhoto.waypoint);
                  if (saved) {
                    setPhotoFile(null);
                    if (fileInput.current) fileInput.current.value = "";
                    setStatus({ tone: "saved", text: "Photo saved and checked on this phone." });
                  }
                  setBusy(false);
                }}
              >
                Retry photo
              </Button>
            )}
            {deleted && (
              <Button className="mt-2" size="sm" variant="outline" disabled={busy} onClick={() => void undoDelete()}>
                <Undo2 className="mr-2 size-4" /> Undo delete
              </Button>
            )}
          </div>
        )}
      </div>

      {waypoints.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-medium">
            Saved places ({waypoints.length})
          </summary>
          <div className="mt-2 space-y-2">
            {waypoints.map((point) => {
              const pointPhotos = photos.filter((photo) => photo.waypointId === point.id);
              const isEditing = editingId === point.id;
              return (
                <article key={point.id} className="space-y-2 rounded-md border bg-background p-2">
                  {isEditing ? (
                    <>
                      <Label htmlFor={`edit-kind-${point.id}`}>Type</Label>
                      <select
                        id={`edit-kind-${point.id}`}
                        className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                        value={editKind}
                        onChange={(event) => setEditKind(event.target.value as SafetyWaypoint["kind"])}
                      >
                        {!EVERYDAY_WAYPOINT_KINDS.some((option) => option.value === editKind) && (
                          <option value={editKind}>{waypointKindLabel(editKind)}</option>
                        )}
                        {EVERYDAY_WAYPOINT_KINDS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                      <Label htmlFor={`edit-note-${point.id}`}>Note</Label>
                      <Input
                        id={`edit-note-${point.id}`}
                        maxLength={240}
                        value={editNote}
                        onChange={(event) => setEditNote(event.target.value)}
                      />
                      <div className="flex gap-2">
                        <Button size="sm" disabled={busy} onClick={() => void saveEdit(point)}>Save changes</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                          <X className="mr-1 size-4" /> Cancel
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium">{waypointKindLabel(point.kind)}</p>
                          {point.note && <p className="text-sm">{point.note}</p>}
                          <p className="font-mono text-[11px] text-muted-foreground">
                            {point.lat.toFixed(5)}, {point.lng.toFixed(5)} · {displayTime(point.recordedAt)}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {point.positionSource === "gps"
                              ? "Live GPS when marked"
                              : point.positionSource === "deadReckon"
                                ? "Estimated by pace and heading"
                                : point.positionSource === "lastKnown"
                                  ? "Last known GPS position"
                                  : "Position source was not recorded"}
                            {point.accuracyM != null ? ` · about ${Math.round(point.accuracyM)} m accuracy` : ""}
                          </p>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <Button size="icon-sm" variant="ghost" aria-label="Edit saved place" onClick={() => beginEdit(point)}>
                            <Edit3 className="size-4" />
                          </Button>
                          <Button size="icon-sm" variant="ghost" aria-label="Delete saved place" disabled={busy} onClick={() => void removeWaypoint(point)}>
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </div>
                      {pointPhotos.map((photo) => (
                        <div key={photo.id} className="flex items-center gap-2 rounded bg-muted/50 p-1">
                          <PhotoPreview photo={photo} />
                          <div className="min-w-0 flex-1 text-[11px] text-muted-foreground">
                            <p>{Math.round(photo.size / 1024)} KB private JPEG</p>
                            <p>{photo.width} × {photo.height}</p>
                          </div>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label="Export photo"
                            onClick={() => downloadBlobFile(`${safeFilename(trailName)}-${point.id}.jpg`, photo.blob)}
                          >
                            <Download className="size-4" />
                          </Button>
                          <Button size="icon-sm" variant="ghost" aria-label="Delete photo" onClick={() => void removePhoto(photo)}>
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      ))}
                    </>
                  )}
                </article>
              );
            })}
          </div>
        </details>
      )}

      <Button size="sm" variant="outline" disabled={busy || waypoints.length === 0} onClick={() => void exportPlaces()}>
        <Download className="mr-2 size-4" /> Export saved places
      </Button>
    </section>
  );
}
