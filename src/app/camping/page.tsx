"use client";
import { apiFetch } from "@/lib/api/client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  CampingFilters,
  type CampingFiltersState,
} from "@/components/camping/camping-filters";
import { CAMPING_TYPE_COLORS, CAMPING_TYPE_LABELS } from "@/lib/constants";
import { campOfficialUrl } from "@/lib/camping/official-url";
import { nearbyCampingBbox } from "@/lib/camping/us-coverage";
import type { Bbox } from "@/lib/camping/bbox";
import type { CampAccessStatus, CampPermitStatus } from "@/lib/camping/evidence";
import { AlertTriangle, Search, Loader2, ExternalLink, LocateFixed, RefreshCw, X } from "lucide-react";

const MapView = dynamic(
  () => import("@/components/map/map-view").then((m) => m.MapView),
  { ssr: false, loading: () => <div className="h-[400px] animate-pulse rounded-lg bg-muted" /> },
);

interface Campground {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  state: string | null;
  parkName: string | null;
  source: string;
  campingType: string;
  description: string | null;
  reservationUrl: string | null;
  metadata?: unknown;
  permitRequired: boolean | null;
  accessStatus: CampAccessStatus;
  permitStatus: CampPermitStatus;
  cachedAt?: string | null;
}

interface CoverageResult {
  mode?: string;
  refreshed?: boolean;
  liveRecords?: number;
}

const PERMIT_LABELS: Record<CampPermitStatus, string> = {
  required: "Permit required",
  seasonal: "Permit seasonal / conditional",
  not_required: "Source reports no permit required",
  unknown: "Permit status unknown",
};

const ACCESS_LABELS: Record<CampAccessStatus, string> = {
  allowed: "Access reported allowed",
  restricted: "Restricted access — verify eligibility",
  private: "Private access",
  unknown: "Access status unknown",
};

const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
];

export default function CampingPage() {
  const [query, setQuery] = useState("");
  const [campgrounds, setCampgrounds] = useState<Campground[]>([]);
  const [selected, setSelected] = useState<Campground | null>(null);
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<CoverageResult | null>(null);
  const [activeBbox, setActiveBbox] = useState<Bbox | null>(null);
  const [nearbyCenter, setNearbyCenter] = useState<{ lat: number; lng: number } | null>(null);
  const initialSearchStarted = useRef(false);
  const [filters, setFilters] = useState<CampingFiltersState>({
    state: "all",
    campingType: "all",
    permitStatus: "all",
    source: "all",
  });

  const runSearch = useCallback(async (options: { sync?: boolean; bbox?: Bbox | null } = {}) => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (filters.state !== "all") params.set("state", filters.state);
    if (filters.campingType !== "all") params.set("campingType", filters.campingType);
    if (filters.permitStatus !== "all") params.set("permitStatus", filters.permitStatus);
    if (filters.source !== "all") params.set("source", filters.source);
    const requestedBbox = options.bbox === undefined ? activeBbox : options.bbox;
    if (requestedBbox) params.set("bbox", requestedBbox.join(","));
    if (options.sync) params.set("sync", "true");

    try {
      const response = await apiFetch(`/api/camping/search?${params}`);
      const data = await response.json() as {
        campgrounds?: Campground[];
        coverage?: CoverageResult;
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || `Camping search failed (${response.status}).`);
      setCampgrounds(data.campgrounds || []);
      setCoverage(data.coverage ?? null);
      setSelected((current) => data.campgrounds?.some((camp) => camp.id === current?.id) ? current : null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Camping search failed. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [activeBbox, query, filters]);

  useEffect(() => {
    if (initialSearchStarted.current) return;
    const initialSearch = window.setTimeout(() => {
      if (initialSearchStarted.current) return;
      initialSearchStarted.current = true;
      void runSearch();
    }, 0);
    return () => window.clearTimeout(initialSearch);
  }, [runSearch]);

  async function searchNearMe() {
    setLocating(true);
    setError(null);
    try {
      if (!("geolocation" in navigator)) throw new Error("This browser does not provide location access. Search by state or name instead.");
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false,
          timeout: 12_000,
          maximumAge: 5 * 60_000,
        });
      });
      const { latitude: lat, longitude: lng } = position.coords;
      const bbox = nearbyCampingBbox(lat, lng);
      if (!bbox) throw new Error("Near-me camping coverage is limited to the United States and U.S. territories.");
      setNearbyCenter({ lat, lng });
      setActiveBbox(bbox);
      await runSearch({ bbox });
    } catch (cause) {
      const geolocationCode = typeof cause === "object" && cause !== null && "code" in cause
        ? Number((cause as { code?: unknown }).code)
        : null;
      if (geolocationCode !== null && Number.isFinite(geolocationCode)) {
        setError(geolocationCode === 1
          ? "Location permission was denied. Search by state or name instead."
          : "Your location could not be read. Try again outdoors or search by state.");
      } else {
        setError(cause instanceof Error ? cause.message : "Your location could not be read.");
      }
    } finally {
      setLocating(false);
    }
  }

  function clearNearbyArea() {
    setActiveBbox(null);
    setNearbyCenter(null);
    void runSearch({ bbox: null });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Camping</h1>
        <p className="text-muted-foreground">
          Find tent and backcountry options in the United States. Listings are discovery leads, not authorization to camp.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Input
          aria-label="Campground or park name"
          className="min-w-56 flex-1"
          placeholder="Search campgrounds (e.g. Yosemite, Muir Woods)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void runSearch()}
        />
        <Button onClick={() => void runSearch()} disabled={loading || locating}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          Search
        </Button>
        <Button variant="secondary" onClick={() => void searchNearMe()} disabled={loading || locating}>
          {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />}
          Near me
        </Button>
        <Button variant="outline" onClick={() => void runSearch({ sync: true })} disabled={loading || locating}>
          <RefreshCw className="h-4 w-4" />
          Refresh official data
        </Button>
      </div>

      {activeBbox && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Searching within about 50 miles of the selected device location.</span>
          <Button size="sm" variant="ghost" onClick={clearNearbyArea}>
            <X className="h-4 w-4" /> Clear area
          </Button>
        </div>
      )}

      {error && (
        <div role="alert" className="flex gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error} Existing results, if any, may be stale.</span>
        </div>
      )}

      <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
        {coverage?.refreshed
          ? `Official-source refresh completed with ${coverage.liveRecords ?? 0} returned record${coverage.liveRecords === 1 ? "" : "s"}. Empty counts can mean an API key or provider was unavailable.`
          : coverage?.mode === "starter"
            ? "Showing built-in starter references. Use Refresh official data for configured NPS, Recreation.gov, and state sources."
            : "Showing cached, starter, or nearby OpenStreetMap records. Access, permits, closures, fire rules, water, and roads can change."}
        {" "}Open the official link and verify current land-manager rules before departure.
      </div>

      <CampingFilters filters={filters} onChange={setFilters} states={US_STATES} />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="h-[400px] overflow-hidden rounded-xl border">
          <MapView
            center={
              selected
                ? { lat: selected.latitude, lng: selected.longitude }
                : nearbyCenter ?? undefined
            }
            zoom={selected ? 10 : 5}
            fitBounds={!selected && activeBbox ? activeBbox : undefined}
            markers={campgrounds.map((c) => ({
              id: c.id,
              lat: c.latitude,
              lng: c.longitude,
              color: CAMPING_TYPE_COLORS[c.campingType] || "#64748b",
              label: c.name,
            }))}
            onMarkerClick={(id) => {
              const camp = campgrounds.find((c) => c.id === id);
              if (camp) setSelected(camp);
            }}
          />
        </div>

        <div className="max-h-[400px] space-y-2 overflow-y-auto">
          {campgrounds.map((camp) => (
            <Card
              key={camp.id}
              className="cursor-pointer transition-colors hover:bg-muted/50"
              onClick={() => setSelected(camp)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-sm">{camp.name}</CardTitle>
                  <Badge
                    style={{
                      backgroundColor: CAMPING_TYPE_COLORS[camp.campingType],
                      color: "white",
                    }}
                  >
                    {CAMPING_TYPE_LABELS[camp.campingType] || camp.campingType}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <p>
                  {[camp.parkName, camp.state, camp.source.toUpperCase()]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  <Badge
                    variant="outline"
                    className={camp.permitStatus === "required" ? "border-amber-600 text-amber-800 dark:text-amber-300" : undefined}
                  >
                    {PERMIT_LABELS[camp.permitStatus] ?? "Permit status unknown"}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={camp.accessStatus === "restricted" ? "border-amber-600 text-amber-800 dark:text-amber-300" : undefined}
                  >
                    {ACCESS_LABELS[camp.accessStatus] ?? "Access status unknown"}
                  </Badge>
                </div>
                <p className="mt-2 text-xs">
                  {camp.cachedAt
                    ? `App record retrieved ${new Date(camp.cachedAt).toLocaleDateString()}; this is not a guarantee that rules are unchanged.`
                    : "Starter reference; source freshness is unknown until refreshed."}
                </p>
                {(() => {
                  const official = campOfficialUrl(camp);
                  if (!official) return null;
                  return (
                    <a
                      href={official}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center text-primary hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {camp.reservationUrl ? "Official details" : "View on OpenStreetMap"} <ExternalLink className="ml-1 h-3 w-3" />
                    </a>
                  );
                })()}
              </CardContent>
            </Card>
          ))}
          {campgrounds.length === 0 && !loading && (
            <p className="text-center text-muted-foreground">
              No campgrounds found. Try adjusting filters or search terms.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
