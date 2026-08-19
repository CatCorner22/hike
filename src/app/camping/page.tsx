"use client";

import { useCallback, useEffect, useState } from "react";
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
import { Search, Loader2, ExternalLink } from "lucide-react";

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
  permitRequired: boolean | null;
}

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
  const [filters, setFilters] = useState<CampingFiltersState>({
    state: "all",
    campingType: "all",
    permitRequired: "all",
    source: "all",
  });

  const search = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (filters.state !== "all") params.set("state", filters.state);
    if (filters.campingType !== "all") params.set("campingType", filters.campingType);
    if (filters.permitRequired !== "all") params.set("permitRequired", filters.permitRequired);
    if (filters.source !== "all") params.set("source", filters.source);

    try {
      const response = await fetch(`/api/camping/search?${params}`);
      const data = await response.json();
      setCampgrounds(data.campgrounds || []);
    } finally {
      setLoading(false);
    }
  }, [query, filters]);

  useEffect(() => {
    search();
  }, [search]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Camping</h1>
        <p className="text-muted-foreground">
          Tent and backcountry camping at state and national parks.
        </p>
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="Search campgrounds (e.g. Yosemite, Muir Woods)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
        />
        <Button onClick={search} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </Button>
      </div>

      <CampingFilters filters={filters} onChange={setFilters} states={US_STATES} />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="h-[400px] overflow-hidden rounded-xl border">
          <MapView
            center={
              selected
                ? { lat: selected.latitude, lng: selected.longitude }
                : undefined
            }
            zoom={selected ? 10 : 5}
            markers={campgrounds.map((c) => ({
              id: c.id,
              lat: c.latitude,
              lng: c.longitude,
              color: CAMPING_TYPE_COLORS[c.campingType] || "#64748b",
              label: c.name,
            }))}
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
                {camp.permitRequired && (
                  <Badge variant="outline" className="mt-1">
                    Permit required
                  </Badge>
                )}
                {camp.reservationUrl && (
                  <a
                    href={camp.reservationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center text-primary hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Reserve <ExternalLink className="ml-1 h-3 w-3" />
                  </a>
                )}
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
