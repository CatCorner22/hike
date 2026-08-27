import type { PioneerSnapshot, PioneerSuggestion, PioneerSuggestionKind } from "./schemas";

// INSTRUMENT OBSERVATIONS — deterministic language when the pioneer model is
// dark, throttled, or has nothing to add. Same objective tone as the LLM path;
// sourced from Klandagi's own readiness rails, not invented.

export interface PioneerGaugeNote {
  why: string;
  next?: string;
}

export interface PioneerGauges {
  pack: number;
  research: number;
  returnHome: number;
  onCourse: number;
  notes: {
    pack: PioneerGaugeNote;
    research: PioneerGaugeNote;
    returnHome: PioneerGaugeNote;
  };
}

export type PioneerMood = "idle" | "happy" | "thinking" | "concerned";

export interface InstrumentObservation {
  kind: PioneerSuggestionKind;
  say: string;
  why: string;
  source: string;
  question?: string;
}

export function measureGauges(snapshot: PioneerSnapshot): PioneerGauges {
  const pack = Math.min(
    1,
    (snapshot.pack.packReady ? 0.5 : 0)
    + (snapshot.pack.tripReady ? 0.2 : 0)
    + (snapshot.pack.corridorReady ? 0.15 : 0)
    + (snapshot.pack.weather === "fresh" || snapshot.pack.hazardBrief === "fresh" ? 0.15 : 0),
  );
  const research = !snapshot.research.present || snapshot.research.provenance === "absent"
    ? 0
    : snapshot.research.stale || snapshot.research.provenance === "unverified"
      ? 0.25
      : snapshot.research.provenance === "mapped_metadata_only"
        ? 0.5
        : 1;
  const returnHome = (snapshot.readiness.iceComplete ? 0.5 : 0)
    + (snapshot.readiness.returnAtSet ? 0.5 : 0);
  const onCourse = pack * 0.4 + research * 0.3 + returnHome * 0.3;
  return {
    pack,
    research,
    returnHome,
    onCourse,
    notes: {
      pack: {
        why: snapshot.pack.packReady
          ? "An offline route pack is on this device."
          : "The offline route pack is not on this device.",
        next: snapshot.pack.packReady
          ? undefined
          : "Prepare the route while there is still signal.",
      },
      research: {
        why: snapshot.research.present
          ? snapshot.research.stale
            ? "Trail research is present and stale."
            : `Trail research provenance is ${snapshot.research.provenance.replaceAll("_", " ")}.`
          : "No trail research brief is loaded.",
        next: snapshot.research.present && !snapshot.research.stale
          ? undefined
          : "Refresh source-backed research before treating any claim as current.",
      },
      returnHome: {
        why: snapshot.readiness.gaps.length > 0
          ? `Still open: ${snapshot.readiness.gaps.join(", ")}.`
          : "Name, emergency contact, and a planned return time are set.",
        next: snapshot.readiness.gaps.length > 0
          ? "Fill the ICE card and a return time before leaving signal."
          : undefined,
      },
    },
  };
}

export function gaugesToMood(gauges: PioneerGauges, hasSnapshot: boolean): PioneerMood {
  if (!hasSnapshot) return "idle";
  if (gauges.onCourse >= 0.75) return "happy";
  if (gauges.onCourse >= 0.4) return "thinking";
  return "concerned";
}

export function instrumentObservations(snapshot: PioneerSnapshot): InstrumentObservation[] {
  const out: InstrumentObservation[] = [];
  const push = (observation: InstrumentObservation) => {
    if (out.length < 3) out.push(observation);
  };

  if (!snapshot.pack.packReady) {
    push({
      kind: "pack",
      say: "The offline route pack is not on this device.",
      why: "Navigation and get-home tools need the prepared pack before signal disappears.",
      question: "Has this route been prepared offline on the phone that will walk it?",
      source: "Klandagi readiness — offline pack",
    });
  }

  if (
    snapshot.pack.officialAlertMaxSeverity === "severe"
    || snapshot.pack.officialAlertMaxSeverity === "extreme"
  ) {
    push({
      kind: "weather",
      say: "The prepare-time official-alert snapshot includes a severe or extreme notice.",
      why: "Cached alerts are not a live all-hazards feed. Verify with the land manager before departure.",
      question: "Has the land manager confirmed whether that notice still applies to this route?",
      source: "Klandagi instrument — official alerts",
    });
  } else if (snapshot.pack.weatherSeverity === "danger" || snapshot.pack.hazardBriefSeverity === "critical") {
    push({
      kind: "weather",
      say: "The cached weather or forecast snapshot flags a danger-grade thermal or weather threshold.",
      why: "Pack-time weather is not current weather. Decision-grade snapshots expire after six hours.",
      question: "Is a current land-manager or NWS product available for the planned start?",
      source: "Klandagi instrument — cached weather",
    });
  } else if (snapshot.pack.weather === "stale" || snapshot.pack.hazardBrief === "stale") {
    push({
      kind: "weather",
      say: "The pack-time weather or forecast snapshot is stale.",
      why: "A snapshot older than six hours is historical only.",
      question: "Can this pack be prepared again while there is still signal?",
      source: "Klandagi instrument — cached weather",
    });
  }

  if (!snapshot.research.present || snapshot.research.provenance === "absent") {
    push({
      kind: "research",
      say: "No trail research brief is loaded.",
      why: "Season, parking, permit, and condition claims stay unknown without a source-backed brief.",
      question: "Has source-backed trail research been opened on this trail?",
      source: "Trail research brief",
    });
  } else if (snapshot.research.stale || snapshot.research.provenance === "unverified") {
    push({
      kind: "research",
      say: "Trail research is stale or unverified.",
      why: "A check time is not a live-condition timestamp. Unverified briefs must not be treated as evidence.",
      question: "Can the research brief be refreshed against current land-manager sources?",
      source: "Trail research brief",
    });
  }

  if (snapshot.readiness.gaps.length > 0) {
    push({
      kind: "readiness",
      say: `Still open for a later reader: ${snapshot.readiness.gaps.slice(0, 2).join("; ")}.`,
      why: "A return time and a working emergency contact are how someone else knows to start looking.",
      question: `Is ${snapshot.readiness.gaps[0]} set on this device?`,
      source: "Klandagi readiness — ICE and return",
    });
  }

  if (snapshot.osmTags?.ford === "yes") {
    push({
      kind: "hazard",
      say: "OpenStreetMap tags identify a ford on this route.",
      why: "A mapped ford is not a current water-level report.",
      question: "Has current crossing condition been verified with a land manager or recent first-hand report?",
      source: "OpenStreetMap",
    });
  }

  return out.slice(0, 3);
}

export function toPioneerSuggestions(
  observations: InstrumentObservation[],
): PioneerSuggestion[] {
  return observations.map((observation) => ({
    kind: observation.kind,
    say: observation.say,
    why: observation.why,
    source: observation.source,
    ...(observation.question ? { question: observation.question } : {}),
  }));
}
