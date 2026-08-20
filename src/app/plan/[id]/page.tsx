"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { NavigateLink } from "@/components/offline/navigate-link";
import { PrepareOffline } from "@/components/offline/prepare-offline";
import { useOfflinePackReady } from "@/hooks/use-offline-pack-ready";
import { packFromPlanApi, persistRoutePack } from "@/lib/offline/load-route-pack";
import { ActivityRecorder } from "@/components/activities/activity-recorder";
import { httpsUrl } from "@/lib/urls";
import { Search, Trash2 } from "lucide-react";

const MapView = dynamic(
  () => import("@/components/map/map-view").then((m) => m.MapView),
  { ssr: false, loading: () => <Skeleton className="h-64 w-full" /> },
);

interface PlanWaypoint {
  name: string;
  lat: number;
  lng: number;
}

interface Plan {
  id: string;
  name: string;
  trailId: string | null;
  plannedDate: string | null;
  notes: string | null;
  campgroundIds: string[] | null;
  waypoints: PlanWaypoint[] | null;
  customGeometry: GeoJSON.LineString | null;
}

interface CampHit {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  reservationUrl?: string | null;
}

interface TrailData {
  id?: string;
  name: string;
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString;
  bbox: [number, number, number, number];
  elevationProfile?: Array<{ distanceMeters: number; elevation: number }>;
}

export default function PlanDetailPage() {
  const params = useParams();
  const planId = params.id as string;

  const [plan, setPlan] = useState<Plan | null>(null);
  const [trail, setTrail] = useState<TrailData | null>(null);
  const [saving, setSaving] = useState(false);
  const [campQuery, setCampQuery] = useState("");
  const [campHits, setCampHits] = useState<CampHit[]>([]);
  const [campSearching, setCampSearching] = useState(false);
  const [wpName, setWpName] = useState("");
  const [wpLat, setWpLat] = useState("");
  const [wpLng, setWpLng] = useState("");
  const packReady = useOfflinePackReady(plan ? `plan-${planId}` : null);

  useEffect(() => {
    fetch(`/api/plans/${planId}`)
      .then((r) => r.json())
      .then(async (p) => {
        setPlan(p);
        if (p.trailId) {
          const tr = await fetch(`/api/trails/${p.trailId}`).then((r) => r.json());
          if (tr.geometry) {
            setTrail(tr);
            const built = packFromPlanApi(`plan-${planId}`, p, tr);
            if (built) {
              try {
                await persistRoutePack(built);
              } catch {
                /* Navigate stays gated until a valid pack is on device */
              }
            }
          }
        } else if (p.customGeometry) {
          const custom = packFromPlanApi(`plan-${planId}`, p, null);
          if (custom) {
            try {
              await persistRoutePack(custom);
            } catch {
              /* Navigate stays gated until a valid pack is on device */
            }
          }
        }
      });
  }, [planId]);

  async function save(updates: Partial<Plan>) {
    if (!plan) return;
    setSaving(true);
    const response = await fetch(`/api/plans/${planId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...plan, ...updates }),
    });
    if (response.ok) {
      setPlan(await response.json());
    }
    setSaving(false);
  }

  async function deletePlan() {
    if (!confirm("Delete this plan?")) return;
    await fetch(`/api/plans/${planId}`, { method: "DELETE" });
    window.location.href = "/plan";
  }

  async function importGpx() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".gpx";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const gpx = await file.text();
      const response = await fetch("/api/sync/offline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gpx, name: file.name }),
      });
      const data = await response.json();
      if (data.geometry) {
        await save({ customGeometry: data.geometry, name: data.name });
        const imported = packFromPlanApi(
          `plan-${planId}`,
          { id: planId, name: data.name || plan?.name || "Imported route", customGeometry: data.geometry },
          null,
        );
        if (imported) {
          try {
            await persistRoutePack(imported);
          } catch {
            /* invalid GPX geometry is rejected */
          }
        }
      }
    };
    input.click();
  }

  if (!plan) return <Skeleton className="h-64 w-full" />;

  const geometry = trail?.geometry || plan.customGeometry;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 className="text-2xl font-bold">Edit plan</h1>
        <div className="flex flex-wrap gap-2">
          <NavigateLink
            href={`/navigate/plan-${plan.id}`}
            ready={packReady}
          />
          <Button variant="outline" onClick={importGpx}>
            Import GPX
          </Button>
          <PrepareOffline
            packId={`plan-${plan.id}`}
            aliases={[plan.id, plan.trailId].filter(Boolean) as string[]}
            name={plan.name}
            geometry={geometry}
            bbox={trail?.bbox}
            elevationProfile={trail?.elevationProfile}
          />
          <Button variant="destructive" onClick={deletePlan}>
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="name">Plan name</Label>
          <Input
            id="name"
            value={plan.name}
            onChange={(e) => setPlan({ ...plan, name: e.target.value })}
            onBlur={() => save({ name: plan.name })}
          />
        </div>
        <div>
          <Label htmlFor="date">Planned date</Label>
          <Input
            id="date"
            type="date"
            value={plan.plannedDate?.slice(0, 10) || ""}
            onChange={(e) => {
              const plannedDate = e.target.value
                ? new Date(e.target.value).toISOString()
                : null;
              setPlan({ ...plan, plannedDate });
              save({ plannedDate });
            }}
          />
        </div>
      </div>

      <div>
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          value={plan.notes || ""}
          onChange={(e) => setPlan({ ...plan, notes: e.target.value })}
          onBlur={() => save({ notes: plan.notes })}
          rows={4}
        />
      </div>

      {trail && (
        <p className="text-sm text-muted-foreground">
          Trail:{" "}
          <Link href={`/trails/${plan.trailId}`} className="text-primary hover:underline">
            {trail.name}
          </Link>
        </p>
      )}

      {geometry && (
        <div className="h-64 overflow-hidden rounded-xl border">
          <MapView
            trailGeometry={geometry}
            fitBounds={trail?.bbox}
          />
        </div>
      )}

      <div className="space-y-3 rounded-xl border p-4">
        <h2 className="text-sm font-semibold">Camping stops</h2>
        <p className="text-xs text-muted-foreground">
          Search and attach campgrounds to this trip. Reservation links must be https.
        </p>
        <div className="flex gap-2">
          <Input
            value={campQuery}
            onChange={(e) => setCampQuery(e.target.value)}
            placeholder="Campground or park name"
          />
          <Button
            variant="outline"
            disabled={campSearching || !campQuery.trim()}
            onClick={async () => {
              setCampSearching(true);
              try {
                const res = await fetch(`/api/camping/search?q=${encodeURIComponent(campQuery.trim())}`);
                const data = await res.json();
                setCampHits(data.campgrounds ?? []);
              } finally {
                setCampSearching(false);
              }
            }}
          >
            <Search className="mr-2 h-4 w-4" />
            Search
          </Button>
        </div>
        {(plan.campgroundIds ?? []).length > 0 && (
          <ul className="space-y-1 text-sm">
            {(plan.campgroundIds ?? []).map((id) => (
              <li key={id} className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-xs">{id}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    void save({
                      campgroundIds: (plan.campgroundIds ?? []).filter((c) => c !== id),
                    })
                  }
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        {campHits.map((hit) => {
          const reserve = httpsUrl(hit.reservationUrl);
          const added = (plan.campgroundIds ?? []).includes(hit.id);
          return (
            <div key={hit.id} className="flex items-center justify-between gap-2 rounded-lg border p-2 text-sm">
              <div>
                <p className="font-medium">{hit.name}</p>
                {reserve && (
                  <a href={reserve} target="_blank" rel="noopener noreferrer" className="text-xs text-primary">
                    Reserve
                  </a>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={added}
                onClick={() =>
                  void save({
                    campgroundIds: [...(plan.campgroundIds ?? []), hit.id],
                    waypoints: [
                      ...(plan.waypoints ?? []),
                      { name: hit.name, lat: hit.latitude, lng: hit.longitude },
                    ],
                  })
                }
              >
                {added ? "Added" : "Add stop"}
              </Button>
            </div>
          );
        })}
      </div>

      <div className="space-y-3 rounded-xl border p-4">
        <h2 className="text-sm font-semibold">Plan waypoints</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          <Input value={wpName} onChange={(e) => setWpName(e.target.value)} placeholder="Name" />
          <Input value={wpLat} onChange={(e) => setWpLat(e.target.value)} placeholder="Lat" />
          <Input value={wpLng} onChange={(e) => setWpLng(e.target.value)} placeholder="Lng" />
        </div>
        <Button
          variant="outline"
          onClick={() => {
            const lat = Number(wpLat);
            const lng = Number(wpLng);
            if (!wpName.trim() || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
            if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;
            void save({
              waypoints: [...(plan.waypoints ?? []), { name: wpName.trim(), lat, lng }],
            });
            setWpName("");
            setWpLat("");
            setWpLng("");
          }}
        >
          Add waypoint
        </Button>
        {(plan.waypoints ?? []).length > 0 && (
          <ul className="space-y-1 text-sm">
            {(plan.waypoints ?? []).map((wp, i) => (
              <li key={`${wp.name}-${i}`} className="flex items-center justify-between">
                <span>
                  {wp.name} · {wp.lat.toFixed(4)}, {wp.lng.toFixed(4)}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    void save({
                      waypoints: (plan.waypoints ?? []).filter((_, idx) => idx !== i),
                    })
                  }
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-lg font-semibold">Record activity</h2>
        <ActivityRecorder planId={plan.id} trailId={plan.trailId ?? undefined} />
      </div>

      {saving && (
        <p className="text-sm text-muted-foreground">Saving...</p>
      )}
    </div>
  );
}
