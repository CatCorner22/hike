import { CloudSun } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { formatDistance } from "@/lib/geo";
import {
  HAZARD_BRIEF_DISCLAIMER,
  describeHazardBrief,
  hazardBriefFreshness,
  type RouteHazardBrief,
} from "@/lib/offline/hazard-brief";
import { summarizeHazards } from "@/lib/offline/route-hazard";

export function HazardBriefCard({
  brief,
  compact = false,
}: {
  brief: RouteHazardBrief | null | undefined;
  compact?: boolean;
}) {
  if (!brief) return null;
  const freshness = hazardBriefFreshness(brief);
  const summary = summarizeHazards(brief.observations);
  const stale = freshness.kind !== "fresh";

  if (compact) {
    return (
      <div className="mb-2 rounded-lg border bg-background px-3 py-2">
        <p className="text-xs font-medium">
          Forecast snapshot
          {summary.highest !== "none" ? ` · ${summary.highest}` : ""}
          {stale ? " · stale" : ""}
        </p>
        <p className="text-[11px] text-muted-foreground">{describeHazardBrief(brief)}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <CloudSun className="h-4 w-4" />
        <h3 className="font-medium">Route forecast snapshot</h3>
      </div>
      <Alert variant={stale || summary.highest === "critical" ? "destructive" : "default"}>
        <CloudSun />
        <AlertTitle>
          {stale
            ? "Cached forecast is stale"
            : summary.highest === "critical"
              ? "Critical thresholds in the snapshot"
              : summary.highest === "watch"
                ? "Watch thresholds in the snapshot"
                : "Snapshot stored"}
        </AlertTitle>
        <AlertDescription>{describeHazardBrief(brief)}</AlertDescription>
      </Alert>
      {(brief.sunrise || brief.sunset) && (
        <p className="text-xs text-muted-foreground">
          Provider sunrise/sunset{brief.sunrise ? ` ${brief.sunrise}` : ""}
          {brief.sunset ? ` / ${brief.sunset}` : ""}. These are model times at prepare, not a daylight guarantee.
        </p>
      )}
      <div className="space-y-2">
        {brief.observations.map((observation, index) => (
          <div key={`${observation.kind}-${observation.observedAt ?? index}`} className="rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{observation.title}</span>
              <Badge variant={observation.severity === "info" ? "outline" : "secondary"}>
                {observation.severity}
              </Badge>
              <Badge variant="outline">{formatDistance(observation.sampleDistanceMeters)} into route</Badge>
            </div>
            {observation.detail && (
              <p className="mt-1 text-xs text-muted-foreground">{observation.detail}</p>
            )}
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{HAZARD_BRIEF_DISCLAIMER}</p>
    </div>
  );
}
