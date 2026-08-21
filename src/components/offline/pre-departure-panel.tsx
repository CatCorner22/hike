"use client";

import { APP_NAME } from "@/lib/brand";
import { GuardianShare } from "@/components/safety/guardian-share";
import { getIceProfile, getOverdueAlarm, type IceProfile } from "@/lib/safety/profile";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, MapPinned, ShieldAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { BailoutRoutePanel } from "@/components/offline/bailout-route-panel";
import { HazardBriefCard } from "@/components/offline/hazard-brief-card";
import { formatDistance, lineLengthMeters } from "@/lib/geo";
import { CORRIDOR_DECISION_DISCLAIMER, deriveCorridorBailouts } from "@/lib/offline/corridor-decisions";
import { selectHazardSamplePoints, type RouteHazardBrief } from "@/lib/offline/hazard-brief";
import { getRoutePack } from "@/lib/offline/route-pack";
import { buildTerrainCorridorSpec, corridorCoverageLabel, corridorSizeLabel } from "@/lib/offline/terrain-corridor";
import { assessDaylightMargin } from "@/lib/safety/decision-support";
import { bailoutRouteCandidates, type PreparedBailoutRoute } from "@/lib/offline/bailout-routes";
import { bailoutDecisionPoints, explicitBailoutCandidates } from "@/lib/safety/bailout";

interface Waypoint { name: string; lat: number; lng: number }

interface PreDeparturePanelProps {
  planId: string;
  trailName?: string;
  plannedDate?: string | null;
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString;
  waypoints?: Waypoint[] | null;
}

function firstCoordinate(geometry: GeoJSON.LineString | GeoJSON.MultiLineString): GeoJSON.Position | null {
  return geometry.type === "LineString"
    ? geometry.coordinates[0] ?? null
    : geometry.coordinates.find((line) => line.length)?.[0] ?? null;
}

function localDeparture(plannedDate: string | null | undefined, time: string): Date | null {
  if (!plannedDate || !time) return null;
  const date = plannedDate.slice(0, 10);
  const value = new Date(`${date}T${time}:00`);
  return Number.isFinite(value.getTime()) ? value : null;
}

export function PreDeparturePanel({ planId, trailName, plannedDate, geometry, waypoints = [] }: PreDeparturePanelProps) {
  const [departureTime, setDepartureTime] = useState("");
  const [paceMph, setPaceMph] = useState("2.0");
  const [profile, setProfile] = useState<IceProfile>({
    name: "",
    iceName: "",
    icePhone: "",
    medical: "",
    partySize: 1,
  });
  const [returnAt, setReturnAt] = useState<string | null>(null);
  const [osmBailouts, setOsmBailouts] = useState<ReturnType<typeof deriveCorridorBailouts>>([]);
  const [hazardBrief, setHazardBrief] = useState<RouteHazardBrief | null>(null);
  const [storedBailouts, setStoredBailouts] = useState<PreparedBailoutRoute[]>([]);

  useEffect(() => {
    void (async () => {
      const [p, alarm] = await Promise.all([getIceProfile(), getOverdueAlarm()]);
      setProfile(p);
      setReturnAt(alarm?.returnAt ?? null);
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getRoutePack(`plan-${planId}`).then((pack) => {
      if (cancelled) return;
      setOsmBailouts(deriveCorridorBailouts({
        geometry,
        features: pack?.corridorFeatures,
      }));
      setHazardBrief(pack?.hazardBrief ?? null);
      setStoredBailouts(pack?.bailoutRoutes ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [planId, geometry]);

  const routeLength = useMemo(() => lineLengthMeters(geometry), [geometry]);
  const corridor = useMemo(() => buildTerrainCorridorSpec({ routeId: `plan-${planId}`, geometry }), [planId, geometry]);
  const hazardSamples = useMemo(() => selectHazardSamplePoints(geometry), [geometry]);
  const userBailouts = useMemo(() => explicitBailoutCandidates(waypoints ?? [], geometry), [waypoints, geometry]);
  const gpxBailouts = useMemo(() => bailoutRouteCandidates(storedBailouts), [storedBailouts]);
  const bailouts = useMemo(
    () => bailoutDecisionPoints([...userBailouts, ...gpxBailouts, ...osmBailouts]),
    [userBailouts, gpxBailouts, osmBailouts],
  );

  const daylight = useMemo(() => {
    const departure = localDeparture(plannedDate, departureTime);
    const start = firstCoordinate(geometry);
    const mph = Number(paceMph);
    if (!departure || !start || !Number.isFinite(mph) || mph <= 0) return null;
    return assessDaylightMargin({
      now: departure,
      lat: Number(start[1]),
      lng: Number(start[0]),
      remainingMeters: routeLength,
      paceMetersPerHour: mph * 1609.344,
    });
  }, [plannedDate, departureTime, geometry, paceMph, routeLength]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pre-departure decision support</CardTitle>
        <CardDescription>Review what {APP_NAME} knows before you prepare the route offline. Unknowns stay unknown.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Route</p>
            <p className="mt-1 text-lg font-semibold">{formatDistance(routeLength)}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Terrain target</p>
            <p className="mt-1 text-sm font-medium">{corridorCoverageLabel(corridor)}</p>
            <p className="text-xs text-muted-foreground">
              {corridorSizeLabel(corridor)} · bbox estimate. Prepare stores this spec plus nearby OSM vectors when Overpass answers. Terrain tiles are not downloaded.
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Forecast samples</p>
            <p className="mt-1 text-lg font-semibold">
              {hazardBrief ? `${hazardBrief.samples.length} stored` : `${hazardSamples.length} planned`}
            </p>
            <p className="text-xs text-muted-foreground">
              {hazardBrief
                ? "Along-route Open-Meteo snapshot from Prepare. Not current weather."
                : "Prepare offline to store a 24-hour forecast snapshot at these route-distance samples."}
            </p>
          </div>
        </div>

        {hazardBrief && (
          <>
            <Separator />
            <HazardBriefCard brief={hazardBrief} />
          </>
        )}

        <Separator />

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Clock3 className="h-4 w-4" />
            <h3 className="font-medium">Daylight margin</h3>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor={`departure-${planId}`}>Planned departure time</Label>
              <Input id={`departure-${planId}`} type="time" value={departureTime} onChange={(event) => setDepartureTime(event.target.value)} />
              {!plannedDate && <p className="mt-1 text-xs text-muted-foreground">Set a planned date above before calculating daylight.</p>}
            </div>
            <div>
              <Label htmlFor={`pace-${planId}`}>Planning pace (mph)</Label>
              <Input id={`pace-${planId}`} inputMode="decimal" value={paceMph} onChange={(event) => setPaceMph(event.target.value)} />
              <p className="mt-1 text-xs text-muted-foreground">This is a planning assumption, not a prediction.</p>
            </div>
          </div>
          {daylight ? (
            <Alert
              variant={
                daylight.severity === "critical" || daylight.severity === "unknown"
                  ? "destructive"
                  : "default"
              }
            >
              {/*
                "unknown" must never render as the green checkmark. Falling through
                to the default branch showed "Daylight margin available" for a
                calculation that could not be done at all.
              */}
              {daylight.severity === "critical" ? (
                <ShieldAlert />
              ) : daylight.severity === "unknown" ? (
                <AlertTriangle />
              ) : daylight.severity === "watch" ? (
                <AlertTriangle />
              ) : (
                <CheckCircle2 />
              )}
              <AlertTitle>
                {daylight.severity === "critical"
                  ? "Daylight risk"
                  : daylight.severity === "unknown"
                    ? "Daylight margin unknown"
                    : daylight.severity === "watch"
                      ? "Limited margin"
                      : "Daylight margin available"}
              </AlertTitle>
              <AlertDescription>
                {daylight.message}
                {daylight.severity !== "unknown" &&
                  Number.isFinite(daylight.eta.getTime()) &&
                  ` Estimated finish: ${daylight.eta.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`}
              </AlertDescription>
            </Alert>
          ) : (
            <p className="text-sm text-muted-foreground">Enter a departure time and valid pace to calculate daylight margin.</p>
          )}
        </div>

        <Separator />

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <MapPinned className="h-4 w-4" />
            <h3 className="font-medium">Bailout candidates</h3>
          </div>
          {bailouts.length ? (
            <div className="space-y-2">
              {bailouts.map((point) => (
                <div key={point.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{point.name}</span>
                    <Badge variant="outline">{formatDistance(point.distanceMeters)} into route</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{point.note}</p>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                {osmBailouts.length ? `${CORRIDOR_DECISION_DISCLAIMER} ` : ""}
                Named “Bailout:” or “Exit:” waypoints stay user-marked. User-supplied GPX is stored only if it meets the route. {APP_NAME} does not invent a straight-line shortcut.
              </p>
            </div>
          ) : (
            <Alert>
              <AlertTriangle />
              <AlertTitle>No bailout candidates yet</AlertTitle>
              <AlertDescription>
                Add a waypoint beginning with “Bailout:” or “Exit:” after you have verified a real trail/road exit,
                or import a bailout GPX that already meets the route. Prepare offline to load OSM features that actually meet the route. {APP_NAME} will not invent a straight-line shortcut.
              </AlertDescription>
            </Alert>
          )}
          <BailoutRoutePanel packId={`plan-${planId}`} name={trailName || `Plan ${planId.slice(0, 8)}`} geometry={geometry} />
        </div>

        <Separator />

        <div className="space-y-2">
          <h3 className="font-medium">Leave-behind and Trip Guardian</h3>
          <p className="text-xs text-muted-foreground">
            Print a card for the fridge before you lose signal. Guardian texts to ICE never treat a missed update as proof of distress.
          </p>
          <GuardianShare
            trailName={trailName || `Plan ${planId.slice(0, 8)}`}
            profile={profile}
            returnAt={returnAt}
            geometry={geometry}
            compact
          />
        </div>

        <Separator />

        <div className="space-y-2">
          <h3 className="font-medium">Planned offline context layers</h3>
          <div className="flex flex-wrap gap-2">{corridor.layers.map((layer) => <Badge key={layer} variant="secondary">{layer}</Badge>)}</div>
          <p className="text-xs text-muted-foreground">
            {corridorSizeLabel(corridor)} for these layers (bounding-box estimate). Vector layers (trails, roads, water, shelters, campsites, landmarks) are fetched from OpenStreetMap when you prepare. Hillshade and contours stay as size estimates only — tiles are not downloaded. The Safety Map remains the guaranteed fallback.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
