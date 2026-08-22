"use client";
import { apiFetch } from "@/lib/api/client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { TrailCard } from "@/components/trails/trail-card";
import { osmTrailId } from "@/lib/ids";
import { nearbyCampingBbox } from "@/lib/camping/us-coverage";
import type { BboxLngLat } from "@/lib/geo/bbox";
import { Search, Loader2, LocateFixed, X } from "lucide-react";
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
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTrail, setSelectedTrail] = useState<TrailSearchResult | null>(null);
  const [activeBbox, setActiveBbox] = useState<BboxLngLat | null>(null);
  const [areaCenter, setAreaCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [areaLabel, setAreaLabel] = useState<string | null>(null);

  const fetchTrails = useCallback(async (trailQuery: string, bbox: BboxLngLat | null) => {
    const params = new URLSearchParams();
    if (trailQuery.trim()) params.set("q", trailQuery.trim());
    if (bbox) params.set("bbox", bbox.join(","));
    const response = await apiFetch(`/api/trails/search?${params}`);
    const data = await response.json() as { trails?: TrailSearchResult[]; error?: string };
    if (!response.ok) throw new Error(data.error || "Trail search failed");
    return data.trails ?? [];
  }, []);

  const search = useCallback(async () => {
    if (query.trim().length < 2 && !activeBbox) return;
    setLoading(true);
    setError(null);

    try {
      let bbox = activeBbox;
      let center = areaCenter;
      let label = areaLabel;
      let results = await fetchTrails(query, bbox);
      // If no route name matched, treat the submitted text as a place once.
      // This is submit-only, not autocomplete, and the server caches lookups.
      if (results.length === 0 && query.trim().length >= 2) {
        const placeResponse = await apiFetch(`/api/places/search?q=${encodeURIComponent(query.trim())}`);
        const placeData = await placeResponse.json() as {
          places?: Array<{ name: string; center: { lat: number; lng: number }; bbox: BboxLngLat }>;
          error?: string;
        };
        if (!placeResponse.ok) throw new Error(placeData.error || "Place search failed");
        const place = placeData.places?.[0];
        if (place) {
          bbox = place.bbox;
          center = place.center;
          label = place.name;
          results = await fetchTrails("", bbox);
          setActiveBbox(bbox);
          setAreaCenter(center);
          setAreaLabel(label);
        }
      }
      setTrails(results);
      setSelectedTrail(results[0] ?? null);
      if (results.length === 0) setError("No named hiking routes were returned. Try a nearby town, park, or a broader trail name.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }, [activeBbox, areaCenter, areaLabel, fetchTrails, query]);

  async function searchNearMe() {
    setLocating(true);
    setError(null);
    try {
      if (!("geolocation" in navigator)) throw new Error("This browser does not provide location access. Search for a park or town instead.");
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false,
          timeout: 12_000,
          maximumAge: 5 * 60_000,
        });
      });
      const center = { lat: position.coords.latitude, lng: position.coords.longitude };
      const bbox = nearbyCampingBbox(center.lat, center.lng);
      if (!bbox) throw new Error("Near-me trail coverage is limited to the United States and U.S. territories.");
      const results = await fetchTrails("", bbox);
      setAreaCenter(center);
      setAreaLabel("your device location");
      setActiveBbox(bbox);
      setTrails(results);
      setSelectedTrail(results[0] ?? null);
      if (results.length === 0) setError("No named hiking routes were returned near this location. Search for a park or trail name.");
    } catch (cause) {
      const code = typeof cause === "object" && cause !== null && "code" in cause
        ? Number((cause as { code?: unknown }).code)
        : null;
      setError(code === 1
        ? "Location permission was denied. Search for a park or town instead."
        : cause instanceof Error ? cause.message : "Your location could not be read.");
    } finally {
      setLocating(false);
    }
  }

  function clearArea() {
    setActiveBbox(null);
    setAreaCenter(null);
    setAreaLabel(null);
    setTrails([]);
    setSelectedTrail(null);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Explore trails</h1>
        <p className="text-muted-foreground">
          Search a trail, park, town, or your nearby area in the United States.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Input
          aria-label="Trail, park, or town"
          className="min-w-56 flex-1"
          placeholder="Trail, park, or town (e.g. Yosemite)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
        />
        <Button onClick={() => void search()} disabled={loading || locating || (query.trim().length < 2 && !activeBbox)}>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Search className="h-4 w-4" />
          )}
          Search
        </Button>
        <Button variant="secondary" onClick={() => void searchNearMe()} disabled={loading || locating}>
          {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />}
          Near me
        </Button>
      </div>

      {activeBbox && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>Area: {areaLabel ?? "selected U.S. area"}</span>
          <Button size="sm" variant="ghost" onClick={clearArea}><X className="h-4 w-4" /> Clear area</Button>
        </div>
      )}

      {areaLabel && <p className="text-xs text-muted-foreground">Place search © OpenStreetMap contributors. Results are named OSM hiking routes, not a completeness guarantee.</p>}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="h-[400px] overflow-hidden rounded-xl border">
        <MapView
          center={selectedTrail?.center ?? areaCenter ?? undefined}
          zoom={selectedTrail ? 11 : 5}
          fitBounds={!selectedTrail && activeBbox ? activeBbox : undefined}
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
