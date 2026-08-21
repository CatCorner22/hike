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
import { formatDistance, lineLengthMeters, nearestPointOnTrail } from "@/lib/geo";
import { sampleRouteByDistance } from "@/lib/offline/route-hazard";
import { buildTerrainCorridorSpec, corridorCoverageLabel } from "@/lib/offline/terrain-corridor";
import { cumulativeDistancesForGeometry } from "@/lib/offline/route-pack";
import { assessDaylightMargin } from "@/lib/safety/decision-support";
import { bailoutDecisionPoints, type BailoutCandidate } from "@/lib/safety/bailout";

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

function explicitBailouts(
  waypoints: Waypoint[],
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString,
): BailoutCandidate[] {
  const cumulative = cumulativeDistancesForGeometry(geometry);
  return waypoints
    .filter((waypoint) => /^(bailout|exit):/i.test(waypoint.name.trim()))
    .flatMap<BailoutCandidate>((waypoint, index) => {
      const snapped = nearestPointOnTrail(waypoint, geometry);
      if (!snapped) return [];
      return [{
        id: `waypoint-bailout-${index}`,
        name: waypoint.name.replace(/^(bailout|exit):\s*/i, "") || waypoint.name,
        kind: "custom" as const,
        lat: waypoint.lat,
        lng: waypoint.lng,
        routeDistanceMeters: cumulative[Math.min(snapped.index, Math.max(0, cumulative.length - 1))] ?? 0,
        note: "User-marked exit candidate. Verify the actual mapped path from the planned route before relying on it.",
      }];
    });
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

  useEffect(() => {
    void (async () => {
      const [p, alarm] = await Promise.all([getIceProfile(), getOverdueAlarm()]);
      setProfile(p);
      setReturnAt(alarm?.returnAt ?? null);
    })();
  }, []);

  const routeLength = useMemo(() => lineLengthMeters(geometry), [geometry]);
  const corridor = useMemo(() => buildTerrainCorridorSpec({ routeId: `plan-${planId}`, geometry }), [planId, geometry]);
  const hazardSamples = useMemo(() => sampleRouteByDistance(geometry, 5000), [geometry]);
  const bailouts = useMemo(() => bailoutDecisionPoints(explicitBailouts(waypoints ?? [], geometry)), [waypoints, geometry]);

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
            <p className="text-xs text-muted-foreground">Manifest only; provider-backed terrain download is not shipped yet.</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Hazard coverage</p>
            <p className="mt-1 text-lg font-semibold">{hazardSamples.length} sample points</p>
            <p className="text-xs text-muted-foreground">Spaced by route distance, not GPX point density.</p>
          </div>
        </div>

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
              <p className="text-xs text-muted-foreground">Only waypoints explicitly named “Bailout:” or “Exit:” appear here. {APP_NAME} does not infer escape routes from ordinary waypoints.</p>
            </div>
          ) : (
            <Alert>
              <AlertTriangle />
              <AlertTitle>No explicit bailout candidates</AlertTitle>
              <AlertDescription>Add a waypoint beginning with “Bailout:” or “Exit:” only after you have verified a real trail/road exit. {APP_NAME} will not invent a straight-line shortcut.</AlertDescription>
            </Alert>
          )}
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
          <p className="text-xs text-muted-foreground">The current production fallback remains the route-only Safety Map. These layers become additive when an offline terrain provider is integrated.</p>
        </div>
      </CardContent>
    </Card>
  );
}
