import { formatReport, reportField } from "@/lib/safety/report-field";

export interface WayfindingTip {
  id: string;
  title: string;
  summary: string;
  steps: string[];
}

/** A backstop is a hard limit you cannot cross without knowing you are lost. */
export function backstopDefinition(): string {
  return (
    "A backstop is a linear feature behind you — road, river, ridge, lake shore — " +
    "that you deliberately keep on one side. If you reach it unexpectedly, STOP: " +
    "you are off the plan and must resection or backtrack."
  );
}

export function backstopChecklist(): string[] {
  return [
    "Pick one backstop before leaving camp: road, creek, cliff base, fence line.",
    "Note which side of the backstop you should stay on while walking out.",
    "If terrain forces you toward the backstop, pause and confirm grid + bearing.",
    "Crossing the backstop without intending to = lost; do not push deeper.",
    "Tell your ICE contact which backstop defines your search area.",
    "On return, handrail the backstop back to the trailhead if visibility drops.",
  ];
}

export function wayfindingTechniques(): WayfindingTip[] {
  return [
    {
      id: "handrail",
      title: "Handrail",
      summary: "Follow a linear feature instead of cross-country.",
      steps: [
        "Choose a creek, ridge crest, power line, or trail as your handrail.",
        "Keep it on the same side (left/right) until the attack point.",
        "Pace count only the departures from the handrail — not the whole leg.",
      ],
    },
    {
      id: "catching",
      title: "Catching feature",
      summary: "A feature you cannot miss that confirms you arrived.",
      steps: [
        "Examples: trail junction, stream crossing, saddle, lake outlet, road bend.",
        "If you pass it without seeing it, you are past the target — stop.",
        "Use a back azimuth from the catching feature to return to the attack point.",
      ],
    },
    {
      id: "attack",
      title: "Attack point",
      summary: "Known location short of the objective where you switch to fine nav.",
      steps: [
        "Navigate to the attack point on easy terrain or a handrail.",
        "From there use pace + compass to the final objective.",
        "If you miss the objective, return to the attack point — do not spiral.",
      ],
    },
    {
      id: "aiming-off",
      title: "Aiming off",
      summary: "Deliberately miss left or right so a linear feature catches you.",
      steps: [
        "Aim 5–10° off the direct bearing toward a trail, road, or river.",
        "When you hit the linear feature, turn toward the objective.",
        "Better to hit a sure line early than wander parallel in timber.",
      ],
    },
    {
      id: "backtrack",
      title: "Backtrack breadcrumbs",
      summary: "Your own track is the best backstop when nothing else exists.",
      steps: [
        "Enable backtrack on this app before leaving trail in whiteout or timber.",
        "Mark waypoints at every decision point (junction, creek, ridge change).",
        "If unsure, follow breadcrumbs back to the last known good grid.",
      ],
    },
    {
      id: "offset",
      title: "Box / offset around obstacle",
      summary: "Structured detour so you rejoin the planned line.",
      steps: [
        "At the obstacle, pace a rectangle: out · turn 90° · parallel · turn back.",
        "Count paces on each leg; do not cut corners in cliff or swamp.",
        "Resume original bearing only after the full box unless terrain forbids it.",
      ],
    },
  ];
}

export function wayfindingAssessment(input: {
  hasBackstop?: boolean;
  visibilityPoor?: boolean;
  offTrail?: boolean;
}): string | null {
  const lines: string[] = [];
  if (input.offTrail && !input.hasBackstop) {
    lines.push("Off trail with no backstop — pick a handrail or backtrack now.");
  }
  if (input.visibilityPoor && !input.hasBackstop) {
    lines.push("Low visibility — mark attack point and stay on handrail.");
  }
  if (lines.length === 0) return null;
  return `Wayfinding: ${lines.join(" ")}`;
}

export function formatWayfindingCard(trailName?: string): string {
  const tips = wayfindingTechniques();
  return formatReport([
    trailName ? `WAYFINDING — ${reportField(trailName)}` : "WAYFINDING CARD",
    "BACKSTOP",
    backstopDefinition(),
    ...backstopChecklist().map((b) => `· ${b}`),
    ...tips.flatMap((t) => [
      t.title.toUpperCase(),
      reportField(t.summary),
      ...t.steps.map((s) => `· ${s}`),
    ]),
  ]);
}
