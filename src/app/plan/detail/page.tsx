"use client";
import { apiFetch } from "@/lib/api/client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { NavigateLink } from "@/components/offline/navigate-link";
import { PrepareOffline } from "@/components/offline/prepare-offline";
import { PreDeparturePanel } from "@/components/offline/pre-departure-panel";
import { useOfflinePackReady } from "@/hooks/use-offline-pack-ready";
import { enrichRoutePack, packFromPlanApi, persistRoutePack } from "@/lib/offline/load-route-pack";
import { getRoutePack } from "@/lib/offline/route-pack";
import { ActivityRecorder } from "@/components/activities/activity-recorder";
import { trailPageHref } from "@/lib/ids";
import { campOfficialUrl } from "@/lib/camping/official-url";
import { httpsUrl } from "@/lib/urls";
import { npsParkCodeFromTags } from "@/lib/nps/park-code";
import { LocateFixed, Search, Trash2 } from "lucide-react";
import { RouteDifficultyPanel } from "@/components/trails/route-difficulty-panel";
import { plannedDateOnly, plannedDateToIso } from "@/lib/plans/date-only";
import { navigateHref } from "@/lib/routes";
import {
  acknowledgePendingEdit,
  accumulatePendingEdit,
  currentPendingEdit,
  mergeConfirmedEdit,
} from "@/lib/plans/edit-merge";

const MapView = dynamic(
  () => import("@/components/map/map-view").then((m) => m.MapView),
  { ssr: false, loading: () => <Skeleton className="h-64 w-full" /> },
);

interface PlanWaypoint {
  id?: string;
  name: string;
  lat: number;
  lng: number;
  kind?: "note" | "camp" | "water" | "bailout";
  notes?: string;
  sourceUrl?: string;
}

interface Plan {
  id: string;
  updatedAt: string;
  name: string;
  trailId: string | null;
  plannedDate: string | null;
  notes: string | null;
  campgroundIds: string[] | null;
  waypoints: PlanWaypoint[] | null;
  customGeometry: GeoJSON.LineString | GeoJSON.MultiLineString | null;
}

interface CampHit {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  reservationUrl?: string | null;
  metadata?: unknown;
  permitStatus?: "required" | "not_required" | "seasonal" | "unknown";
  accessStatus?: "allowed" | "restricted" | "private" | "unknown";
}

interface TrailData {
  id?: string;
  osmId?: string;
  osmType?: string;
  name: string;
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString;
  bbox: [number, number, number, number];
  elevationProfile?: Array<{ distanceMeters: number; elevation: number }>;
  tags?: Record<string, string>;
}

type PlanActionError = {
  kind: "save" | "delete" | "import" | "offline-pack";
  message: string;
};

type PendingGpx = { gpx: string; fileName: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPosition(value: unknown): value is GeoJSON.Position {
  return Array.isArray(value)
    && value.length >= 2
    && value.length <= 3
    && value.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate))
    && value[0] >= -180
    && value[0] <= 180
    && value[1] >= -90
    && value[1] <= 90;
}

function isRouteGeometry(value: unknown): value is GeoJSON.LineString | GeoJSON.MultiLineString {
  if (!isRecord(value) || !Array.isArray(value.coordinates)) return false;
  if (value.type === "LineString") {
    return value.coordinates.length >= 2 && value.coordinates.every(isPosition);
  }
  return value.type === "MultiLineString"
    && value.coordinates.length > 0
    && value.coordinates.every((line) =>
      Array.isArray(line) && line.length >= 2 && line.every(isPosition)
    );
}

function isPlanPayload(value: unknown): value is Plan {
  if (!isRecord(value)) return false;
  return typeof value.id === "string"
    && typeof value.updatedAt === "string"
    && Number.isFinite(Date.parse(value.updatedAt))
    && typeof value.name === "string"
    && (value.trailId === null || typeof value.trailId === "string")
    && (value.plannedDate === null || typeof value.plannedDate === "string")
    && (value.notes === null || typeof value.notes === "string")
    && (value.campgroundIds === null || Array.isArray(value.campgroundIds))
    && (value.waypoints === null || Array.isArray(value.waypoints))
    && (value.customGeometry === null || isRouteGeometry(value.customGeometry));
}

function isTrailPayload(value: unknown): value is TrailData {
  return isRecord(value) && typeof value.name === "string" && isRouteGeometry(value.geometry);
}

async function jsonBody(response: Response): Promise<Record<string, unknown>> {
  try {
    const value = await response.json() as unknown;
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

function responseMessage(
  response: Response,
  body: Record<string, unknown>,
  fallback: string,
): string {
  return typeof body.error === "string" ? body.error : `${fallback} (${response.status}).`;
}

const editablePlanKeys = [
  "name",
  "trailId",
  "plannedDate",
  "notes",
  "campgroundIds",
  "waypoints",
  "customGeometry",
] as const;

export default function PlanDetailPage() {
  // useSearchParams under Suspense: the detail screen lives at a fixed path with
  // ?id= because the static build has no server to expand a dynamic segment.
  return (
    <Suspense fallback={null}>
      <PlanDetailTarget />
    </Suspense>
  );
}

function PlanDetailTarget() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const planId = searchParams.get("id");
  useEffect(() => {
    if (!planId) router.replace("/plan");
  }, [planId, router]);
  if (!planId) return null;
  return <PlanDetail planId={planId} />;
}

function PlanDetail({ planId }: { planId: string }) {
  const router = useRouter();

  const [plan, setPlan] = useState<Plan | null>(null);
  const planRef = useRef<Plan | null>(null);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const [trail, setTrail] = useState<TrailData | null>(null);
  const [pendingSaves, setPendingSaves] = useState(0);
  const [saveAcknowledged, setSaveAcknowledged] = useState(false);
  const [pendingSave, setPendingSave] = useState<Partial<Plan> | null>(null);
  const pendingSaveRef = useRef<Partial<Plan> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [actionError, setActionError] = useState<PlanActionError | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pendingGpx, setPendingGpx] = useState<PendingGpx | null>(null);
  const [campQuery, setCampQuery] = useState("");
  const [campHits, setCampHits] = useState<CampHit[]>([]);
  const [campSearching, setCampSearching] = useState(false);
  const [campError, setCampError] = useState<string | null>(null);
  const [wpName, setWpName] = useState("");
  const [wpLat, setWpLat] = useState("");
  const [wpLng, setWpLng] = useState("");
  const [wpKind, setWpKind] = useState<NonNullable<PlanWaypoint["kind"]>>("note");
  const [wpLocationStatus, setWpLocationStatus] = useState<string | null>(null);
  const [trailWarning, setTrailWarning] = useState<string | null>(null);
  const offlineReadiness = useOfflinePackReady(plan ? `plan-${planId}` : null);

  useEffect(() => {
    let cancelled = false;
    void apiFetch(`/api/plans/${encodeURIComponent(planId)}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await jsonBody(response);
        if (!response.ok) throw new Error(responseMessage(response, body, "Plan could not be loaded"));
        if (!isPlanPayload(body)) throw new Error("The plan response was incomplete or invalid.");

        let loadedTrail: TrailData | null = null;
        let nextTrailWarning: string | null = null;
        if (body.trailId) {
          const trailResponse = await apiFetch(`/api/trails/${encodeURIComponent(body.trailId)}`, {
            cache: "no-store",
          });
          const trailBody = await jsonBody(trailResponse);
          if (trailResponse.ok && isTrailPayload(trailBody)) {
            loadedTrail = trailBody;
          } else if (body.customGeometry) {
            nextTrailWarning = "Trail details could not be loaded. The saved route on this plan is still here.";
          } else {
            throw new Error(responseMessage(trailResponse, trailBody, "The plan loaded, but its route could not be loaded"));
          }
        }

        const built = loadedTrail
          ? packFromPlanApi(`plan-${planId}`, body, loadedTrail)
          : body.customGeometry
            ? packFromPlanApi(`plan-${planId}`, body, null)
            : null;
        if (built) {
          try {
            const existing = await getRoutePack(built.id);
            await persistRoutePack(enrichRoutePack(built, existing));
          } catch {
            // Loading the editable server plan still succeeds. Navigate remains gated
            // until Prepare offline acknowledges a valid on-device pack.
          }
        }
        if (cancelled) return;
        planRef.current = body;
        setPlan(body);
        setTrail(loadedTrail);
        setTrailWarning(nextTrailWarning);
        setLoadError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : "The plan could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, [loadAttempt, planId]);

  function updateDraft(updates: Partial<Plan>) {
    const current = planRef.current;
    if (!current) return;
    const next = { ...current, ...updates };
    planRef.current = next;
    setPlan(next);
    setSaveAcknowledged(false);
  }

  async function save(updates: Partial<Plan>): Promise<Plan | null> {
    setPendingSaves((count) => count + 1);
    setSaveAcknowledged(false);
    setActionError((current) => pendingSaveRef.current ? current : null);

    let resolveResult: (value: Plan | null) => void = () => undefined;
    const result = new Promise<Plan | null>((resolve) => {
      resolveResult = resolve;
    });
    saveChainRef.current = saveChainRef.current
      .catch(() => undefined)
      .then(async () => {
        const requestBase = planRef.current;
        if (!requestBase) throw new Error("The plan is not loaded.");
        const response = await apiFetch(`/api/plans/${encodeURIComponent(planId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...updates, updatedAt: requestBase.updatedAt }),
        });
        const body = await jsonBody(response);
        if (!response.ok) throw new Error(responseMessage(response, body, "Plan changes were not saved"));
        if (!isPlanPayload(body)) throw new Error("The save response was incomplete or invalid.");

        const latestDraft = planRef.current ?? requestBase;
        const next = mergeConfirmedEdit({
          confirmed: body,
          requestBase,
          latestDraft,
          submitted: updates,
          editableKeys: editablePlanKeys,
        });
        planRef.current = next;
        setPlan(next);
        const remaining = acknowledgePendingEdit(pendingSaveRef.current, updates);
        pendingSaveRef.current = remaining;
        setPendingSave(remaining);
        setSaveAcknowledged(remaining === null);
        if (remaining === null) {
          setActionError((current) => current?.kind === "save" ? null : current);
        }
        resolveResult(next);
      })
      .catch((error) => {
        const pending = accumulatePendingEdit(pendingSaveRef.current, updates);
        pendingSaveRef.current = pending;
        setPendingSave(pending);
        setSaveAcknowledged(false);
        setActionError({
          kind: "save",
          message: error instanceof Error ? error.message : "Plan changes were not saved.",
        });
        resolveResult(null);
      })
      .finally(() => {
        setPendingSaves((count) => Math.max(0, count - 1));
      });
    return result;
  }

  async function performDelete(requireConfirmation: boolean) {
    if (requireConfirmation && !confirm("Delete this plan?")) return;
    setDeleting(true);
    setActionError(null);
    try {
      const response = await apiFetch(`/api/plans/${encodeURIComponent(planId)}`, { method: "DELETE" });
      const body = await jsonBody(response);
      if (!response.ok) throw new Error(responseMessage(response, body, "Plan was not deleted"));
      router.push("/plan");
    } catch (error) {
      setActionError({
        kind: "delete",
        message: error instanceof Error ? error.message : "Plan was not deleted.",
      });
    } finally {
      setDeleting(false);
    }
  }

  async function processGpx(pending: PendingGpx) {
    setImporting(true);
    setActionError(null);
    try {
      const response = await apiFetch("/api/sync/offline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gpx: pending.gpx, name: pending.fileName }),
      });
      const data = await jsonBody(response);
      if (!response.ok) throw new Error(responseMessage(response, data, "GPX could not be imported"));
      const importedName = typeof data.name === "string" && data.name.trim()
        ? data.name.trim()
        : planRef.current?.name ?? "Imported route";
      if (!isRouteGeometry(data.geometry)) {
        throw new Error("The GPX response did not contain a valid route line.");
      }
      const imported = packFromPlanApi(
        `plan-${planId}`,
        { id: planId, name: importedName, customGeometry: data.geometry },
        null,
      );
      if (!imported) throw new Error("The GPX response did not contain a valid route line.");

      const saved = await save({ customGeometry: imported.geometry, name: importedName });
      if (!saved) {
        setActionError({
          kind: "import",
          message: "The GPX route was parsed, but the plan did not acknowledge the update. Retry the import before preparing or navigating this route.",
        });
        return;
      }
      setPendingGpx(null);
      try {
        const existing = await getRoutePack(imported.id);
        await persistRoutePack(enrichRoutePack(imported, existing));
      } catch {
        setActionError({
          kind: "offline-pack",
          message: "The route was saved to this plan, but its offline copy was not prepared. Use Prepare offline and wait for confirmation before leaving signal.",
        });
      }
    } catch (error) {
      setActionError({
        kind: "import",
        message: error instanceof Error ? error.message : "GPX could not be imported.",
      });
    } finally {
      setImporting(false);
    }
  }

  function importGpx() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".gpx";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const pending = { gpx: await file.text(), fileName: file.name };
        setPendingGpx(pending);
        await processGpx(pending);
      } catch (error) {
        setActionError({
          kind: "import",
          message: error instanceof Error ? error.message : "The GPX file could not be read.",
        });
      }
    };
    input.click();
  }

  if (!plan && loadError) {
    return (
      <section className="mx-auto max-w-xl space-y-3 rounded-xl border bg-card p-6">
        <h1 className="text-xl font-semibold">Plan unavailable</h1>
        <p role="alert" className="text-sm text-destructive">{loadError}</p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={() => {
              setLoadError(null);
              setLoadAttempt((attempt) => attempt + 1);
            }}
          >
            Retry
          </Button>
          <Button type="button" variant="outline" onClick={() => router.push("/plan")}>Back to plans</Button>
        </div>
      </section>
    );
  }
  if (!plan) return <Skeleton className="h-64 w-full" />;
  const geometry = trail?.geometry || plan.customGeometry;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 className="text-2xl font-bold">Edit plan</h1>
        <div className="flex flex-wrap gap-2">
          <NavigateLink href={navigateHref(`plan-${plan.id}`)} {...offlineReadiness} />
          <Button variant="outline" disabled={importing} onClick={importGpx}>
            {importing ? "Importing…" : "Import GPX"}
          </Button>
          <PrepareOffline
            packId={`plan-${plan.id}`}
            aliases={[plan.id, plan.trailId].filter(Boolean) as string[]}
            name={plan.name}
            geometry={geometry}
            bbox={trail?.bbox}
            elevationProfile={trail?.elevationProfile}
            parkCode={npsParkCodeFromTags(trail?.tags)}
          />
          <Button
            variant="destructive"
            disabled={deleting || pendingSaves > 0}
            onClick={() => void performDelete(true)}
          >
            <Trash2 className="mr-2 h-4 w-4" />{deleting ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </div>

      {actionError && (
        <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <p role="alert" className="text-sm text-destructive">{actionError.message}</p>
          <div className="flex flex-wrap gap-2">
            {actionError.kind === "save" && pendingSave && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pendingSaves > 0}
                onClick={() => {
                  const retry = currentPendingEdit(pendingSaveRef.current, planRef.current);
                  if (retry) void save(retry);
                }}
              >
                Retry save
              </Button>
            )}
            {actionError.kind === "delete" && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={deleting}
                onClick={() => void performDelete(false)}
              >
                Retry delete
              </Button>
            )}
            {actionError.kind === "import" && pendingGpx && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={importing}
                onClick={() => void processGpx(pendingGpx)}
              >
                Retry import
              </Button>
            )}
            {actionError.kind === "save" && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  planRef.current = null;
                  pendingSaveRef.current = null;
                  setPlan(null);
                  setTrail(null);
                  setPendingSave(null);
                  setSaveAcknowledged(false);
                  setActionError(null);
                  setLoadAttempt((attempt) => attempt + 1);
                }}
              >
                Reload server copy
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="name">Plan name</Label>
          <Input
            id="name"
            value={plan.name}
            onChange={(event) => updateDraft({ name: event.target.value })}
            onBlur={() => void save({ name: planRef.current?.name ?? plan.name })}
          />
        </div>
        <div>
          <Label htmlFor="date">Planned date</Label>
          <Input
            id="date"
            type="date"
            value={plannedDateOnly(plan.plannedDate) ?? ""}
            onChange={(e) => {
              const plannedDate = e.target.value ? plannedDateToIso(e.target.value) : null;
              updateDraft({ plannedDate });
              void save({ plannedDate });
            }}
          />
        </div>
      </div>

      <div>
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          value={plan.notes || ""}
          onChange={(event) => updateDraft({ notes: event.target.value })}
          onBlur={() => void save({ notes: planRef.current?.notes ?? null })}
          rows={4}
        />
      </div>

      {trail && (
        <p className="text-sm text-muted-foreground">Trail: <Link href={trailPageHref(plan.trailId ?? trail.id ?? "", trail.osmType, trail.osmId)} className="text-primary hover:underline">{trail.name}</Link></p>
      )}
      {trailWarning && <p role="status" className="text-sm text-amber-800 dark:text-amber-300">{trailWarning}</p>}

      {geometry && (
        <>
          <div className="h-64 overflow-hidden rounded-xl border">
            <MapView trailGeometry={geometry} fitBounds={trail?.bbox} />
          </div>
          <RouteDifficultyPanel
            geometry={geometry}
            elevationProfile={trail?.elevationProfile}
            tags={trail?.tags}
          />
          <PreDeparturePanel
            planId={plan.id}
            trailName={plan.name}
            plannedDate={plan.plannedDate}
            planNotes={plan.notes}
            geometry={geometry}
            waypoints={plan.waypoints}
          />
        </>
      )}

      {!geometry && (
        <section className="space-y-3 rounded-xl border bg-card p-6 text-center">
          <h2 className="text-lg font-semibold">Choose a route before planning details</h2>
          <p className="text-sm text-muted-foreground">
            Find a mapped trail or import a GPX file. Klandagi will not invent a route for an empty trip.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={() => router.push("/explore")}><Search className="mr-2 h-4 w-4" />Find a trail</Button>
            <Button variant="outline" disabled={importing} onClick={importGpx}>
              {importing ? "Importing…" : "Import GPX"}
            </Button>
          </div>
        </section>
      )}

      {geometry && <details className="rounded-xl border p-4">
        <summary className="cursor-pointer text-sm font-semibold">Camping stops</summary>
        <div className="mt-3 space-y-3">
        <p className="text-xs text-muted-foreground">Search and attach camping leads. Adding a stop does not verify access, permits, closures, roads, water, or availability.</p>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Label htmlFor="camping-search">Campground or park</Label>
            <Input
              id="camping-search"
              value={campQuery}
              onChange={(e) => setCampQuery(e.target.value)}
              placeholder="Name or park"
            />
          </div>
          <Button
            variant="outline"
            disabled={campSearching || !campQuery.trim()}
            onClick={async () => {
              setCampSearching(true);
              setCampError(null);
              try {
                const res = await apiFetch(`/api/camping/search?q=${encodeURIComponent(campQuery.trim())}`);
                const data = await res.json() as { campgrounds?: CampHit[]; error?: string };
                if (!res.ok) throw new Error(data.error || `Camping search failed (${res.status}).`);
                setCampHits(data.campgrounds ?? []);
              } catch (error) {
                setCampError(error instanceof Error ? error.message : "Camping search failed.");
              } finally {
                setCampSearching(false);
              }
            }}
          >
            <Search className="mr-2 h-4 w-4" />Search
          </Button>
        </div>
        {campError && <p role="alert" className="text-xs text-destructive">{campError}</p>}
        {(plan.campgroundIds ?? []).length > 0 && (
          <ul className="space-y-1 text-sm">
            {(plan.campgroundIds ?? []).map((id) => (
              <li key={id} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {(plan.waypoints ?? []).find((waypoint) => waypoint.id === id)?.name ?? "Saved camping stop"}
                  </p>
                  {(plan.waypoints ?? []).find((waypoint) => waypoint.id === id)?.notes && (
                    <p className="text-xs text-muted-foreground">
                      {(plan.waypoints ?? []).find((waypoint) => waypoint.id === id)?.notes}
                    </p>
                  )}
                  {(() => {
                    const source = httpsUrl((plan.waypoints ?? []).find((waypoint) => waypoint.id === id)?.sourceUrl);
                    return source ? <a href={source} target="_blank" rel="noopener noreferrer" className="text-xs text-primary">Official details</a> : null;
                  })()}
                </div>
                <Button variant="ghost" size="sm" onClick={() => void save({
                  campgroundIds: (plan.campgroundIds ?? []).filter((campId) => campId !== id),
                  waypoints: (plan.waypoints ?? []).filter((waypoint) => waypoint.id !== id),
                })}>Remove</Button>
              </li>
            ))}
          </ul>
        )}
        {campHits.map((hit) => {
          const reserve = campOfficialUrl(hit);
          const added = (plan.campgroundIds ?? []).includes(hit.id);
          return (
            <div key={hit.id} className="flex items-center justify-between gap-2 rounded-lg border p-2 text-sm">
              <div>
                <p className="font-medium">{hit.name}</p>
                <p className="text-xs text-muted-foreground">
                  Permit: {hit.permitStatus === "required" ? "required" : hit.permitStatus === "seasonal" ? "seasonal / conditional" : hit.permitStatus === "not_required" ? "source reports not required" : "unknown"}
                  {" · "}Access: {hit.accessStatus === "allowed" ? "reported allowed" : hit.accessStatus === "restricted" ? "restricted" : "unknown"}
                </p>
                {reserve && <a href={reserve} target="_blank" rel="noopener noreferrer" className="text-xs text-primary">{hit.reservationUrl ? "Official details" : "View on OpenStreetMap"}</a>}
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={added}
                onClick={() => void save({
                  campgroundIds: [...(plan.campgroundIds ?? []), hit.id],
                  waypoints: [...(plan.waypoints ?? []), {
                    id: hit.id,
                    name: hit.name,
                    lat: hit.latitude,
                    lng: hit.longitude,
                    kind: "camp",
                    notes: `Permit: ${hit.permitStatus ?? "unknown"} · Access: ${hit.accessStatus ?? "unknown"}`,
                    ...(reserve ? { sourceUrl: reserve } : {}),
                  }],
                })}
              >
                {added ? "Added" : "Add stop"}
              </Button>
            </div>
          );
        })}
        </div>
      </details>}

      {geometry && <details className="rounded-xl border p-4">
        <summary className="cursor-pointer text-sm font-semibold">Waypoints and exits</summary>
        <div className="mt-3 space-y-3">
        <p className="text-xs text-muted-foreground">Choose “Bailout / exit” only for a real trail or road exit you have verified. A label does not create a route through unknown terrain.</p>
        <div className="grid gap-2 sm:grid-cols-4">
          <div>
            <Label htmlFor="waypoint-name">Waypoint name</Label>
            <Input id="waypoint-name" value={wpName} onChange={(e) => setWpName(e.target.value)} placeholder="Creek crossing" />
          </div>
          <div>
            <Label htmlFor="waypoint-type">Waypoint type</Label>
            <select
              id="waypoint-type"
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={wpKind}
              onChange={(event) => setWpKind(event.target.value as NonNullable<PlanWaypoint["kind"]>)}
            >
              <option value="note">Note</option>
              <option value="camp">Camp</option>
              <option value="water">Water</option>
              <option value="bailout">Bailout / exit</option>
            </select>
          </div>
          <div>
            <Label htmlFor="waypoint-latitude">Latitude</Label>
            <Input id="waypoint-latitude" inputMode="decimal" value={wpLat} onChange={(e) => setWpLat(e.target.value)} placeholder="37.1234" />
          </div>
          <div>
            <Label htmlFor="waypoint-longitude">Longitude</Label>
            <Input id="waypoint-longitude" inputMode="decimal" value={wpLng} onChange={(e) => setWpLng(e.target.value)} placeholder="-119.1234" />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={async () => {
              const lat = Number(wpLat);
              const lng = Number(wpLng);
              if (!wpName.trim() || !Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
                setWpLocationStatus("Enter a waypoint name and valid latitude/longitude.");
                return;
              }
              const saved = await save({
                waypoints: [
                  ...(planRef.current?.waypoints ?? []),
                  { name: wpName.trim(), lat, lng, kind: wpKind },
                ],
              });
              if (!saved) return;
              setWpName(""); setWpLat(""); setWpLng(""); setWpKind("note"); setWpLocationStatus(null);
            }}
          >
            Add waypoint
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              if (!navigator.geolocation) {
                setWpLocationStatus("This browser cannot provide a location.");
                return;
              }
              setWpLocationStatus("Getting current location…");
              navigator.geolocation.getCurrentPosition(
                (position) => {
                  setWpLat(position.coords.latitude.toFixed(6));
                  setWpLng(position.coords.longitude.toFixed(6));
                  setWpLocationStatus(`Current location added (±${Math.round(position.coords.accuracy)} m). Review it before saving.`);
                },
                () => setWpLocationStatus("Current location was unavailable or permission was denied."),
                { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
              );
            }}
          >
            <LocateFixed className="mr-2 h-4 w-4" />Use current location
          </Button>
        </div>
        {wpLocationStatus && <p role="status" className="text-xs text-muted-foreground">{wpLocationStatus}</p>}
        {(plan.waypoints ?? []).length > 0 && (
          <ul className="space-y-1 text-sm">
            {(plan.waypoints ?? []).map((wp, i) => (
              <li key={`${wp.name}-${i}`} className="flex items-center justify-between">
                <span>{wp.name} · {wp.kind ?? "note"} · {wp.lat.toFixed(4)}, {wp.lng.toFixed(4)}</span>
                <Button variant="ghost" size="sm" onClick={() => void save({ waypoints: (plan.waypoints ?? []).filter((_, idx) => idx !== i) })}>Remove</Button>
              </li>
            ))}
          </ul>
        )}
        </div>
      </details>}

      {geometry && <div>
        <h2 className="mb-2 text-lg font-semibold">Record activity</h2>
        <ActivityRecorder planId={plan.id} trailId={plan.trailId ?? undefined} />
      </div>}

      <p aria-live="polite" className="text-sm text-muted-foreground">
        {pendingSaves > 0
          ? "Saving…"
          : saveAcknowledged && !actionError
            ? "Saved"
            : "Changes are saved only after the server confirms them."}
      </p>
    </div>
  );
}
