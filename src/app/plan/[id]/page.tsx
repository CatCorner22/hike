"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { cachePlanOffline } from "@/lib/offline";
import { Download, Navigation, Trash2 } from "lucide-react";

const MapView = dynamic(
  () => import("@/components/map/map-view").then((m) => m.MapView),
  { ssr: false, loading: () => <Skeleton className="h-64 w-full" /> },
);

interface Plan {
  id: string;
  name: string;
  trailId: string | null;
  plannedDate: string | null;
  notes: string | null;
  campgroundIds: string[] | null;
  customGeometry: GeoJSON.LineString | null;
}

interface TrailData {
  name: string;
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString;
  bbox: [number, number, number, number];
}

export default function PlanDetailPage() {
  const params = useParams();
  const planId = params.id as string;

  const [plan, setPlan] = useState<Plan | null>(null);
  const [trail, setTrail] = useState<TrailData | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/plans/${planId}`)
      .then((r) => r.json())
      .then(async (p) => {
        setPlan(p);
        if (p.trailId) {
          const tr = await fetch(`/api/trails/${p.trailId}`).then((r) => r.json());
          if (tr.geometry) setTrail(tr);
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
      }
    };
    input.click();
  }

  async function saveOffline() {
    if (!plan) return;
    await cachePlanOffline({ id: plan.id, plan: plan as unknown as Record<string, unknown> });
    alert("Plan saved for offline use");
  }

  if (!plan) return <Skeleton className="h-64 w-full" />;

  const geometry = trail?.geometry || plan.customGeometry;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 className="text-2xl font-bold">Edit plan</h1>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/navigate/plan-${plan.id}`}
            className={buttonVariants({ variant: "outline" })}
          >
            <Navigation className="mr-2 h-4 w-4" />
            Navigate
          </Link>
          <Button variant="outline" onClick={importGpx}>
            Import GPX
          </Button>
          <Button variant="outline" onClick={saveOffline}>
            <Download className="mr-2 h-4 w-4" />
            Save offline
          </Button>
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

      {saving && (
        <p className="text-sm text-muted-foreground">Saving...</p>
      )}
    </div>
  );
}
