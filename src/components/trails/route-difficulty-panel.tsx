"use client";

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { lineLengthMeters } from "@/lib/geo";
import {
  buildRouteDifficultySnapshot,
  type RouteDifficultyFactor,
} from "@/lib/trails/difficulty-intelligence";

interface RouteDifficultyPanelProps {
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString;
  elevationProfile?: Array<{ distanceMeters: number; elevation: number }>;
  reportedDistanceMeters?: number;
  tags?: Record<string, string>;
  daylightSummary?: string | null;
}

const primaryFactors = new Set<RouteDifficultyFactor["id"]>([
  "distance",
  "elevation",
  "grade",
  "altitude",
]);

function stateLabel(state: RouteDifficultyFactor["state"]): string {
  if (state === "measured") return "Measured";
  if (state === "reported") return "Reported";
  return "Unknown";
}

export function RouteDifficultyPanel({
  geometry,
  elevationProfile = [],
  reportedDistanceMeters,
  tags,
  daylightSummary,
}: RouteDifficultyPanelProps) {
  const snapshot = useMemo(
    () => buildRouteDifficultySnapshot({
      geometryDistanceMeters: lineLengthMeters(geometry),
      reportedDistanceMeters,
      elevationProfile,
      tags,
      daylightSummary,
    }),
    [daylightSummary, elevationProfile, geometry, reportedDistanceMeters, tags],
  );
  const primary = snapshot.factors.filter((factor) => primaryFactors.has(factor.id));
  const context = snapshot.factors.filter((factor) => !primaryFactors.has(factor.id));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">What makes this route demanding?</CardTitle>
        <p className="text-sm text-muted-foreground">
          Inspectable measurements and mapped evidence—never a single opaque difficulty score.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Badge variant="secondary">{snapshot.knownCount} factors with evidence</Badge>
          <Badge variant={snapshot.unknownCount > 0 ? "outline" : "secondary"}>
            {snapshot.unknownCount} unknown
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-3 sm:grid-cols-2">
          {primary.map((factor) => (
            <div key={factor.id} className="rounded-lg border p-3">
              <div className="flex items-start justify-between gap-2">
                <dt className="text-sm font-medium">{factor.label}</dt>
                <Badge variant={factor.state === "unknown" ? "outline" : "secondary"}>
                  {stateLabel(factor.state)}
                </Badge>
              </div>
              <dd className="mt-1 font-semibold">{factor.value}</dd>
              <dd className="mt-1 text-xs text-muted-foreground">{factor.detail}</dd>
              <dd className="mt-1 text-[11px] text-muted-foreground">Source: {factor.source}</dd>
            </div>
          ))}
        </dl>

        <details>
          <summary className="cursor-pointer text-sm font-medium">
            Terrain, route-finding, water, and daylight evidence
          </summary>
          <dl className="mt-3 divide-y rounded-lg border">
            {context.map((factor) => (
              <div key={factor.id} className="grid gap-1 p-3 sm:grid-cols-[10rem_1fr]">
                <dt className="text-sm font-medium">{factor.label}</dt>
                <dd>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span>{factor.value}</span>
                    <Badge variant={factor.state === "unknown" ? "outline" : "secondary"}>
                      {stateLabel(factor.state)}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{factor.detail}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">Source: {factor.source}</p>
                </dd>
              </div>
            ))}
          </dl>
        </details>

        <p className="text-xs text-muted-foreground">
          Unknown means the app lacks evidence—not that the factor is absent. Verify current conditions,
          access, crossings, water, and required skills with authoritative local sources before departure.
        </p>
      </CardContent>
    </Card>
  );
}
