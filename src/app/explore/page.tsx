"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { TrailCard } from "@/components/trails/trail-card";
import { osmTrailId } from "@/lib/ids";
import { Search, Loader2 } from "lucide-react";
import type { TrailSearchResult } from "@/lib/osm/overpass";

const MapView = dynamic(
  () => import("@/components/map/map-view").then((m) => m.MapView),
  { ssr: false, loading: () => <div className="h-[400px] animate-pulse rounded-lg bg-muted" /> },
);

export default function ExplorePage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [trails, setTrails] = useState<TrailSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTrail, setSelectedTrail] = useState<TrailSearchResult | null>(null);

  const search = useCallback(async () => {
    if (query.length < 2) return;
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/trails/search?q=${encodeURIComponent(query)}`,
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Search failed");
      setTrails(data.trails);
      if (data.trails.length > 0) setSelectedTrail(data.trails[0]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }, [query]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Explore trails</h1>
        <p className="text-muted-foreground">
          Search OpenStreetMap hiking routes across the United States.
        </p>
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="Search trails (e.g. Angels Landing, Appalachian Trail)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
        />
        <Button onClick={search} disabled={loading || query.length < 2}>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Search className="h-4 w-4" />
          )}
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="h-[400px] overflow-hidden rounded-xl border">
        <MapView
          center={selectedTrail?.center}
          zoom={selectedTrail ? 11 : 5}
          markers={trails.map((t) => ({
            id: osmTrailId(t.osmType, t.osmId),
            lat: t.center.lat,
            lng: t.center.lng,
            color: selectedTrail?.osmId === t.osmId && selectedTrail?.osmType === t.osmType ? "#16a34a" : "#64748b",
            label: t.name,
          }))}
          onMarkerClick={(id) => {
            const trail = trails.find((t) => osmTrailId(t.osmType, t.osmId) === id);
            if (!trail) return;
            setSelectedTrail(trail);
            router.push(`/trails/${osmTrailId(trail.osmType, trail.osmId)}`);
          }}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {trails.map((trail) => (
          <div
            key={osmTrailId(trail.osmType, trail.osmId)}
            onMouseEnter={() => setSelectedTrail(trail)}
          >
            <TrailCard
              trail={trail}
              href={`/trails/${osmTrailId(trail.osmType, trail.osmId)}`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
