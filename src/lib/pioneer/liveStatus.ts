// Live status copy for the Pioneer panel — what the pioneer is doing NOW.
//
// Pattern source: SuperByte's Hugging Face Chat UI MessageUpdate / RouterMetadata
// adaptation. Pioneer never becomes a chat, but hikers still need a present-tense
// account of the layer speaking (pioneer vs local instrument) and whether a read
// is in flight. Strings are deterministic; no model self-grading.

export type PioneerDeployStatus = "unknown" | "unreachable" | "off" | "on";
export type PioneerFeedbackSource = "pioneer" | "instrument" | null;

export function pioneerLiveStatus(args: {
  hasSnapshot: boolean;
  deploy: PioneerDeployStatus;
  observing: boolean;
  feedbackSource: PioneerFeedbackSource;
  observationCount: number;
}): string {
  const { hasSnapshot, deploy, observing, feedbackSource, observationCount } = args;
  if (!hasSnapshot) return "Waiting for trail or plan details.";
  if (observing) return "Reading the prep snapshot…";
  if (feedbackSource === "pioneer" && observationCount > 0) {
    return observationCount === 1
      ? "Pioneer read complete — 1 observation."
      : `Pioneer read complete — ${observationCount} observations.`;
  }
  if (feedbackSource === "instrument" && observationCount > 0) {
    return observationCount === 1
      ? "Local gauges speaking — 1 instrument reading."
      : `Local gauges speaking — ${observationCount} instrument readings.`;
  }
  if (deploy === "off") {
    return "Pioneer dark on this deployment — gauges still run locally.";
  }
  if (deploy === "unreachable") {
    return "Could not reach the pioneer — gauges still run locally.";
  }
  if (deploy === "unknown") return "Checking whether the pioneer is open…";
  return "Drift gauges are live. Pioneer observations appear as the snapshot settles.";
}

/** Glanceable layer chip — SuperByte / HF RouterMetadata. */
export function pioneerLayerLabel(
  feedbackSource: PioneerFeedbackSource,
  observing: boolean,
  deploy: PioneerDeployStatus,
): { label: string; tone: "pioneer" | "instrument" | "reading" | "dark" | "idle" } {
  if (observing) return { label: "Reading", tone: "reading" };
  if (feedbackSource === "pioneer") return { label: "Pioneer", tone: "pioneer" };
  if (feedbackSource === "instrument") return { label: "Instrument", tone: "instrument" };
  if (deploy === "off") return { label: "Pioneer dark", tone: "dark" };
  if (deploy === "unreachable") return { label: "Pioneer unreachable", tone: "dark" };
  return { label: "Standing by", tone: "idle" };
}
