import type { Severity } from "@/lib/safety/severity";
import { formatReport, reportField } from "@/lib/safety/report-field";

export const DISCLAIMER =
  "Training aid, not medical direction. Call emergency services, evacuate, and get professional care as soon as possible.";

export interface MarchPawsStep {
  letter: string;
  name: string;
  checks: string[];
}

export interface TourniquetStatus {
  minutes: number;
  severity: Severity;
  message: string;
  conversionWindow: boolean;
}

export interface HemorrhageAction {
  severity: Severity;
  actions: string[];
}

export interface ShockAssessment {
  severity: Severity;
  label: string;
  actions: string[];
}

export type TriageCategory = "green" | "yellow" | "red" | "black";

export interface TriageResult {
  category: TriageCategory;
  label: string;
  reasoning: string;
}

export interface CasualtyTreatment {
  time: string;
  treatment: string;
}

export interface CasualtyTourniquet {
  limb: string;
  time: string;
}

export interface CasualtyCardInput {
  name?: string;
  time?: string;
  mechanism?: string;
  injuries?: string;
  pulse?: string;
  resp?: string;
  avpu?: string;
  treatments?: ReadonlyArray<CasualtyTreatment>;
  tourniquets?: CasualtyTourniquet[];
}

/** CoTCCC MARCH-PAWS sequence, adapted to civilian wilderness care and evacuation. */
export function marchPawsSteps(): MarchPawsStep[] {
  return [
    {
      letter: "M",
      name: "Massive hemorrhage",
      checks: [
        "Look for life-threatening external bleeding; expose only as needed and protect from cold.",
        "Use firm direct pressure, wound packing, or a limb tourniquet when indicated.",
      ],
    },
    {
      letter: "A",
      name: "Airway",
      checks: [
        "Can the casualty speak? If not, open and maintain the airway with trained skills and positioning.",
        "Place an unconscious breathing casualty in a recovery position if trauma conditions allow.",
      ],
    },
    {
      letter: "R",
      name: "Respiration",
      checks: [
        "Expose and check the chest and back for penetrating injury, unequal movement, or worsening distress.",
        "Seal an open chest wound and reassess breathing during evacuation.",
      ],
    },
    {
      letter: "C",
      name: "Circulation",
      checks: [
        "Recheck all bleeding control and look for signs of shock without delaying evacuation.",
        "Keep the casualty still and reassess the radial pulse and mental status repeatedly.",
      ],
    },
    {
      letter: "H",
      name: "Hypothermia / head injury",
      checks: [
        "Insulate from the ground, block wind and wet, and cover the head even in mild weather.",
        "Check pupils, mental status, and worsening headache, vomiting, or seizure; protect the spine based on mechanism and findings.",
      ],
    },
    {
      letter: "P",
      name: "Pain",
      checks: [
        "Reassure, splint injuries, and use only medications already prescribed or authorized for this casualty.",
        "Avoid oral medicines or fluids when airway, consciousness, or surgery concerns make swallowing unsafe.",
      ],
    },
    {
      letter: "A",
      name: "Antibiotics",
      checks: [
        "For an open wound, follow the casualty's prescribed plan or direction from a clinician or medical control.",
        "Do not improvise antibiotics; document any medicine, dose, and time given.",
      ],
    },
    {
      letter: "W",
      name: "Wounds",
      checks: [
        "Cover wounds with clean dressings, control bleeding, and reassess for soak-through.",
        "Do not remove embedded objects; stabilize them and protect the area for evacuation.",
      ],
    },
    {
      letter: "S",
      name: "Splinting",
      checks: [
        "Check and document circulation, sensation, and movement before and after splinting.",
        "Pad and secure the injury in position found unless there is no distal circulation and trained guidance directs otherwise.",
      ],
    },
  ];
}

/** CoTCCC tourniquet conversion guidance: consider conversion before 2 h only when not in shock and evacuation is delayed; do not convert after 6 h. */
export function tourniquetStatus(appliedAtMs: number, now = Date.now()): TourniquetStatus | null {
  if (!Number.isFinite(appliedAtMs) || !Number.isFinite(now) || appliedAtMs < 0 || now < appliedAtMs) {
    return null;
  }
  const rawMinutes = (now - appliedAtMs) / 60_000;
  // Truncate rather than round: at 119.96 min, rounding displayed "120 min" beside the
  // "under 2 h" message with the conversion window still open — a contradiction at the
  // exact moment the 2 h decision is being made. Flooring keeps the displayed elapsed
  // time on the same side of the threshold as the branch that produced the message.
  const minutes = Math.floor(rawMinutes * 10) / 10;
  if (rawMinutes < 120) {
    return {
      minutes,
      severity: "warning",
      message:
        "Tourniquet time is under 2 h. If evacuation is delayed and the casualty is not in shock, a trained rescuer may consider conversion to a pressure dressing before 2 h while watching the wound.",
      conversionWindow: true,
    };
  }
  if (rawMinutes < 360) {
    return {
      minutes,
      severity: "critical",
      message:
        "The 2 h preferred conversion window has passed. Prioritize rapid evacuation, do not loosen or remove the tourniquet just to check the wound, and clearly mark its time.",
      conversionWindow: false,
    };
  }
  return {
    minutes,
    severity: "critical",
    message:
      "Tourniquet has been in place 6 h or more. Do not convert it; leave it in place, mark the time, and relay it to rescuers immediately.",
    conversionWindow: false,
  };
}

/** CoTCCC documentation practice: mark a tourniquet with the limb and application time in Zulu time. */
export function formatTourniquetMark(appliedAt: Date, limb: string): string | null {
  if (!Number.isFinite(appliedAt.getTime()) || typeof limb !== "string" || limb.trim().length === 0) return null;
  const hours = String(appliedAt.getUTCHours()).padStart(2, "0");
  const minutes = String(appliedAt.getUTCMinutes()).padStart(2, "0");
  return `TQ ${reportField(limb).toUpperCase()} ${hours}${minutes}Z`;
}

/** CoTCCC external-hemorrhage control guidance: use limb tourniquets for life-threatening extremity bleeding and packing plus pressure for junctional wounds. */
export function hemorrhageAction(input: {
  bleeding: "spurting" | "steady" | "oozing";
  site: "limb" | "junctional" | "torso" | "neck";
}): HemorrhageAction | null {
  if (
    !["spurting", "steady", "oozing"].includes(input.bleeding) ||
    !["limb", "junctional", "torso", "neck"].includes(input.site)
  ) {
    return null;
  }

  if (input.site === "limb") {
    if (input.bleeding === "spurting") {
      return {
        severity: "critical",
        actions: [
          "Apply a commercial tourniquet high and tight on the injured limb; tighten until bleeding stops and no distal pulse is felt.",
          "Note the application time, do not cover the tourniquet, prevent hypothermia, and evacuate urgently.",
        ],
      };
    }
    return {
      severity: input.bleeding === "steady" ? "warning" : "caution",
      actions: [
        "Apply firm direct pressure, then a pressure dressing; reassess for continued bleeding.",
        "If bleeding becomes life-threatening or cannot be controlled, apply a limb tourniquet and evacuate.",
      ],
    };
  }

  if (input.site === "junctional") {
    return {
      severity: "critical",
      actions: [
        "Pack the wound firmly with hemostatic gauze if available or plain gauze, then hold sustained direct pressure and apply a pressure dressing.",
        "A limb tourniquet will not control groin, armpit, or other junctional bleeding. Evacuate immediately.",
      ],
    };
  }

  if (input.site === "torso") {
    return {
      severity: "critical",
      actions: [
        "Apply direct pressure and an appropriate dressing; do not probe or blindly pack a torso wound.",
        "Treat for shock, prevent hypothermia, and arrange immediate evacuation.",
      ],
    };
  }

  return {
    severity: "critical",
    actions: [
      "Apply direct pressure with a dressing while protecting the airway; do not use a tourniquet on the neck.",
      "Do not pack a neck wound if it could compromise the airway. Arrange immediate evacuation.",
    ],
  };
}

/** CoTCCC shock recognition uses absent radial pulse or altered mental status as practical field indicators when a blood-pressure cuff is unavailable. */
export function shockAssessment(input: {
  radialPulsePresent: boolean;
  alteredMental: boolean;
  heartRate?: number;
  capRefillSec?: number;
}): ShockAssessment | null {
  if (
    (input.heartRate != null && (!Number.isFinite(input.heartRate) || input.heartRate < 0)) ||
    (input.capRefillSec != null && (!Number.isFinite(input.capRefillSec) || input.capRefillSec < 0))
  ) {
    return null;
  }
  if (!input.radialPulsePresent || input.alteredMental) {
    return {
      severity: "critical",
      label: "Shock suspected",
      actions: [
        "Control bleeding again, keep the casualty lying still if injuries allow, and evacuate urgently.",
        "Insulate from the ground and weather; reassess mental status, radial pulse, and breathing frequently.",
      ],
    };
  }
  if ((input.heartRate ?? 0) >= 100 || (input.capRefillSec ?? 0) > 2) {
    return {
      severity: "warning",
      label: "Concerning circulation signs",
      actions: [
        "Recheck for bleeding and trend radial pulse, mental status, and breathing while arranging evaluation.",
        "Keep the casualty warm and still; deterioration to absent radial pulse or altered mental status means shock is suspected.",
      ],
    };
  }
  return {
    severity: "info",
    label: "No field shock indicator found",
    actions: [
      "Continue serial checks; a present radial pulse and normal mental status do not rule out injury.",
      "Control bleeding, prevent heat loss, and evacuate for significant trauma.",
    ],
  };
}

/** CoTCCC chest-trauma assessment identifies worsening respiratory distress and unilateral findings as warning signs for tension pneumothorax. */
export function tensionPneumothoraxSigns(): string[] {
  return [
    "Increasing respiratory distress, air hunger, or rapidly worsening shortness of breath",
    "One side of the chest moving less or markedly reduced breath sounds on one side when assessed by a trained provider",
    "Cyanosis, worsening agitation, altered mental status, or signs of shock after chest trauma",
    "Distended neck veins or tracheal deviation are late and unreliable signs; do not wait for them",
  ];
}

/** CoTCCC chest-wound guidance: use a vented seal when available, vent or briefly burp it if distress worsens, and reserve needle decompression for trained providers. */
export function chestSealGuidance(): string[] {
  return [
    "Wipe the skin and apply a vented chest seal over a penetrating chest wound; check the back for an exit wound.",
    "If respiratory distress worsens after sealing, briefly lift an edge (burp the seal) to vent, then reassess and reseal as needed.",
    "Needle decompression is a trained-provider skill. Do not attempt it without appropriate training, authorization, and equipment.",
    "Treat for shock, prevent hypothermia, and evacuate immediately.",
  ];
}

/** Wilderness Medical Society hypothermia guidance and CoTCCC hypothermia prevention: stop conductive, convective, and evaporative heat loss in trauma patients. */
export function hypothermiaWrapSteps(): string[] {
  return [
    "Move out of wind and wet, remove wet clothing when it can be done without delaying lifesaving care, and dry the casualty.",
    "Insulate from the ground FIRST with pads, packs, rope, or other dry layers before adding top insulation.",
    "Add a vapor barrier and dry insulation around the casualty in a full burrito-style wrap; keep it intact for evacuation.",
    "Cover the head and neck while leaving the face clear and the airway observable.",
    "Do not place direct heat on the skin; protect against burns and avoid rough handling of a severely cold casualty.",
  ];
}

/** CoTCCC casualty documentation principles and DD Form 1380 fields, adapted as a concise civilian wilderness handoff. */
export function casualtyCard(input: CasualtyCardInput): string {
  const treatments = input.treatments?.length
    ? input.treatments.map((entry) => `${reportField(entry.time, 80)} ${reportField(entry.treatment, 160)}`).join(" | ")
    : "NONE STATED";
  const tourniquets = input.tourniquets?.length
    ? input.tourniquets.map((entry) => `${reportField(entry.limb, 80)} ${reportField(entry.time, 80)}`).join(" | ")
    : "NONE STATED";

  return formatReport([
    "CASUALTY CARD / TCCC",
    `NAME: ${reportField(input.name ?? "UNKNOWN")}`,
    `TIME: ${reportField(input.time ?? "UNKNOWN")}`,
    `MECHANISM: ${reportField(input.mechanism ?? "NOT STATED")}`,
    `INJURIES: ${reportField(input.injuries ?? "NOT STATED")}`,
    `SIGNS: PULSE ${reportField(input.pulse ?? "NOT STATED", 80)} / RESP ${reportField(input.resp ?? "NOT STATED", 80)} / AVPU ${reportField(input.avpu ?? "NOT STATED", 80)}`,
    `TREATMENTS: ${reportField(treatments)}`,
    `TOURNIQUETS: ${reportField(tourniquets)}`,
  ]);
}

/** START triage: walking wounded are green; no breathing is black after airway positioning; a respiratory rate over 30, an absent radial pulse, or inability to obey commands is red; remaining casualties are yellow. */
export function triageCategory(input: {
  walking: boolean;
  breathing: boolean;
  radialPulse: boolean;
  obeysCommands: boolean;
  /** Breaths per minute. START makes >30 an immediate (red) criterion in its own right. */
  respiratoryRate?: number;
}): TriageResult {
  if (input.walking) {
    return {
      category: "green",
      label: "Minor / walking wounded",
      reasoning: "Walking casualties are categorized green in START and directed to a safe collection area for reassessment.",
    };
  }
  if (!input.breathing) {
    return {
      category: "black",
      label: "Expectant / deceased",
      reasoning: "No breathing after opening and positioning the airway is categorized black in START; continue care only when resources allow.",
    };
  }
  const fastBreathing =
    input.respiratoryRate != null &&
    Number.isFinite(input.respiratoryRate) &&
    input.respiratoryRate > 30;
  // A fractional rate just over the line (30.4) must not round down into "30 ... is
  // over 30" — keep one decimal whenever rounding would land on the threshold itself.
  const shownRate = fastBreathing && Math.round(input.respiratoryRate!) <= 30
    ? input.respiratoryRate!.toFixed(1)
    : String(Math.round(input.respiratoryRate ?? 0));
  if (fastBreathing || !input.radialPulse || !input.obeysCommands) {
    return {
      category: "red",
      label: "Immediate",
      reasoning: fastBreathing
        ? `A respiratory rate of ${shownRate} breaths/min is over 30, which is categorized red in START.`
        : !input.radialPulse
          ? "A breathing casualty without a radial pulse is categorized red in START."
          : "A breathing casualty who cannot obey simple commands is categorized red in START.",
    };
  }
  return {
    category: "yellow",
    label: "Delayed",
    reasoning: "The casualty is non-walking but breathing, has a radial pulse, and obeys commands, so START categorizes them yellow.",
  };
}
