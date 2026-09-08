import { formatDistance } from "@/lib/geo";
import { CORRIDOR_DECISION_DISCLAIMER } from "@/lib/offline/corridor-decisions";
import type { DecisionPoint } from "@/lib/safety/decision-support";

export function NextDecisionCard({
  point,
  aheadMeters,
  alongRouteOnly = false,
}: {
  point: DecisionPoint | null;
  aheadMeters?: number;
  alongRouteOnly?: boolean;
}) {
  if (!point) return null;
  const distance = Number.isFinite(aheadMeters) ? aheadMeters : point.distanceMeters;
  return (
    <div className="mb-2 rounded-lg border bg-background px-3 py-2">
      <p className="text-xs font-medium">
        Next: {point.name}
        {Number.isFinite(distance)
          ? ` · ${formatDistance(Math.max(0, distance ?? 0))} ${alongRouteOnly ? "along route" : "ahead"}`
          : ""}
      </p>
      <p className="text-[11px] text-muted-foreground">
        {point.note ?? CORRIDOR_DECISION_DISCLAIMER}
      </p>
    </div>
  );
}
