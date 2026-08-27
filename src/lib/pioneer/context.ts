import type { PioneerSnapshot } from "./schemas";
import { redactNavMath } from "./snapshot";

/**
 * The deterministic app reading of the prep snapshot, summarized for the prompt.
 * Marked trusted: values come from Klandagi's own parsers and gauges — nothing
 * here is model-generated. Coordinates and bearings are never included.
 */
export function parseContextFor(snapshot: PioneerSnapshot): string {
  const lines: string[] = [
    `Trail: ${redactNavMath(snapshot.trailName)}`,
    `Offline pack on this device: ${snapshot.pack.packReady ? "yes" : "no"}`,
    `Trip launch assets verified: ${snapshot.pack.tripReady ? "yes" : "no"}`,
    `Corridor context stored: ${snapshot.pack.corridorReady ? "yes" : "no"}`,
    `Weather snapshot: ${snapshot.pack.weather} (severity ${snapshot.pack.weatherSeverity})`,
    `Forecast brief: ${snapshot.pack.hazardBrief} (severity ${snapshot.pack.hazardBriefSeverity})`,
    `Official alerts: ${snapshot.pack.officialAlerts} (count ${snapshot.pack.officialAlertCount}, max ${snapshot.pack.officialAlertMaxSeverity})`,
    `User-supplied bailout tracks: ${snapshot.pack.userBailoutCount}`,
    `Research: ${snapshot.research.provenance}${snapshot.research.stale ? ", stale" : ""}; sources ${snapshot.research.sourceCount}`,
    `Research unknowns: difficulty=${snapshot.research.difficultyUnknown} parking=${snapshot.research.parkingUnknown} permits=${snapshot.research.permitsUnknown} conditions=${snapshot.research.conditionsUnknown}`,
    `ICE complete: ${snapshot.readiness.iceComplete ? "yes" : "no"}`,
    `Return time set: ${snapshot.readiness.returnAtSet ? "yes" : "no"}`,
  ];
  if (snapshot.readiness.gaps.length > 0) {
    lines.push(`Readiness gaps: ${snapshot.readiness.gaps.join("; ")}`);
  }
  if (snapshot.osmTags) {
    const tags = Object.entries(snapshot.osmTags)
      .map(([key, value]) => `${key}=${redactNavMath(value)}`)
      .join("; ");
    if (tags) lines.push(`OpenStreetMap tags: ${tags}`);
  }
  if (snapshot.research.hazards.length > 0) {
    lines.push(`Source-backed hazards: ${snapshot.research.hazards.map(redactNavMath).join(" | ")}`);
  }
  if (snapshot.plan) {
    lines.push(
      `Plan: notes=${snapshot.plan.hasNotes ? "present" : "absent"}, waypoints=${snapshot.plan.waypointCount}, date=${snapshot.plan.plannedDateSet ? "set" : "unset"}`,
    );
  }
  return `DETERMINISTIC PREP SNAPSHOT (trusted; produced by Klandagi's own parsers — no coordinates or bearings):\n${lines.join("\n")}`;
}
