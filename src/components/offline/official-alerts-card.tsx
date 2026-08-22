import { ExternalLink, ShieldAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { formatDistance } from "@/lib/geo";
import {
  describeOfficialAlertSnapshot,
  officialAlertFreshness,
  type RouteOfficialAlertSnapshot,
} from "@/lib/offline/official-alerts";

export function OfficialAlertsCard({
  snapshot,
  compact = false,
}: {
  snapshot: RouteOfficialAlertSnapshot | null | undefined;
  compact?: boolean;
}) {
  if (!snapshot) return null;
  const freshness = officialAlertFreshness(snapshot);
  const urgent = snapshot.alerts.some((alert) => alert.severity === "extreme" || alert.severity === "severe");
  const sourcesChecked = snapshot.sources.filter((source) => source.status === "checked" || source.status === "partial").length;

  if (compact) {
    return (
      <div className="mb-2 rounded-lg border bg-background px-3 py-2">
        <p className="text-xs font-medium">
          Official alert snapshot · {snapshot.alerts.length} stored · {freshness}
        </p>
        <p className="text-[11px] text-muted-foreground">{describeOfficialAlertSnapshot(snapshot)}</p>
      </div>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <ShieldAlert className="h-4 w-4" />
        <h3 className="font-medium">Official alert snapshot</h3>
      </div>
      <Alert variant={freshness !== "fresh" || urgent || sourcesChecked === 0 ? "destructive" : "default"}>
        <ShieldAlert />
        <AlertTitle>
          {freshness === "clock_error"
            ? "Snapshot time cannot be trusted"
            : freshness === "stale"
              ? "Cached official alerts are stale"
              : urgent
                ? "Severe or extreme alert stored"
                : sourcesChecked === 0
                  ? "Official sources were not checked"
                  : snapshot.alerts.length
                    ? "Official alerts stored"
                    : "No active alerts returned when checked"}
        </AlertTitle>
        <AlertDescription>{describeOfficialAlertSnapshot(snapshot)}</AlertDescription>
      </Alert>

      <div className="grid gap-2 sm:grid-cols-2">
        {snapshot.sources.map((source) => (
          <div key={source.source} className="rounded-lg border p-3 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium uppercase">{source.source}</span>
              <Badge variant={source.status === "checked" ? "outline" : "secondary"}>{source.status.replace("_", " ")}</Badge>
            </div>
            <p className="mt-1 text-muted-foreground">{source.detail}</p>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        {snapshot.alerts.slice(0, 8).map((alert) => (
          <article key={alert.id} className="rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={alert.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary hover:underline"
              >
                {alert.title} <ExternalLink className="inline h-3 w-3" />
              </a>
              <Badge variant="outline">{alert.source.toUpperCase()}</Badge>
              <Badge variant={alert.severity === "extreme" || alert.severity === "severe" ? "destructive" : "secondary"}>
                {alert.severity}
              </Badge>
              <Badge variant="outline">{formatDistance(alert.sampleDistanceMeters)} into route</Badge>
            </div>
            {alert.detail && <p className="mt-1 text-xs text-muted-foreground">{alert.detail}</p>}
            {alert.instruction && <p className="mt-2 text-xs"><span className="font-medium">Official instruction:</span> {alert.instruction}</p>}
            {alert.expiresAt && <p className="mt-1 text-[11px] text-muted-foreground">Provider expiry: {alert.expiresAt}</p>}
          </article>
        ))}
        {snapshot.alerts.length > 8 && (
          <p className="text-xs text-muted-foreground">{snapshot.alerts.length - 8} additional stored alerts are omitted from this compact view.</p>
        )}
      </div>
    </section>
  );
}
