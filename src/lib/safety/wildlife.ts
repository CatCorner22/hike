import type { Severity } from "@/lib/safety/severity";

export const DISCLAIMER =
  "Training aid, not a substitute for local wildlife regulations or professional medical care. Give wildlife space, carry appropriate deterrents, and call emergency services for an attack or envenomation.";

export type BearSpecies = "black" | "grizzly" | "unknown";
export type BearBehavior = "unaware" | "aware-calm" | "defensive-bluff" | "predatory" | "attacking";

export interface WildlifeEncounter {
  severity: Severity;
  actions: string[];
}

/** NPS bear-safety guidance and bear-spray field studies: never run; defensive grizzly contact calls for playing dead, while predatory attacks and black-bear attacks call for fighting back. Bear spray has better field outcomes than firearms. */
export function bearEncounter(input: {
  species: BearSpecies;
  behavior: BearBehavior;
  sprayAvailable: boolean;
}): WildlifeEncounter {
  const spray = input.sprayAvailable
    ? "Keep bear spray immediately available and use it if the bear comes within its labelled effective range; studies show bear spray is more effective than a firearm in bear encounters."
    : "You have no bear spray available; do not substitute a firearm for distance, calm behavior, and an exit route.";

  if (input.behavior === "unaware") {
    return {
      severity: "info",
      actions: [
        "Do not approach, feed, or surprise it. Leave by a route that gives the bear space and keeps wind and noise in mind.",
        "Keep the group together and speak normally as you back away; never run.",
        spray,
      ],
    };
  }
  if (input.behavior === "aware-calm") {
    return {
      severity: "caution",
      actions: [
        "Stay calm, group up, make yourselves identifiable as people, and back away slowly without blocking its travel route.",
        "Do not run, turn your back, or approach for a photo.",
        spray,
      ],
    };
  }
  if (input.behavior === "defensive-bluff") {
    if (input.species === "grizzly") {
      return {
        severity: "warning",
        actions: [
          "Stand your ground during a bluff charge, speak calmly, and deploy bear spray if the bear closes; never run.",
          "If a defensive grizzly attack makes contact, lie face-down, protect your neck, spread your legs, and play dead until the bear leaves.",
          spray,
        ],
      };
    }
    return {
      severity: "warning",
      actions: [
        "Stand your ground during a bluff charge, speak calmly, and deploy bear spray if the bear closes; never run.",
        input.species === "black"
          ? "If a black bear attacks, fight back hard with anything available; do not curl up."
          : "Species is uncertain: keep distance, use spray if it closes, and escape only when the bear gives you space.",
        spray,
      ],
    };
  }
  if (input.behavior === "predatory") {
    return {
      severity: "critical",
      actions: [
        "A persistent, stalking, or predatory approach is an emergency. Do not run; face the bear, group up, get spray ready, and make forceful noise.",
        "If a predatory bear attacks, fight back hard with anything available and keep fighting.",
        spray,
      ],
    };
  }
  if (input.species === "black") {
    return {
      severity: "critical",
      actions: [
        "Do not run. If a black bear attacks, fight back hard with anything available and keep fighting.",
        "Use bear spray if you can do so safely.",
        spray,
      ],
    };
  }
  if (input.species === "grizzly") {
    return {
      severity: "critical",
      actions: [
        "Do not run. If this is a defensive grizzly attack, lie face-down, protect your neck, spread your legs, and play dead once it makes contact.",
        "If the attack is persistent or predatory, fight back hard with anything available.",
        spray,
      ],
    };
  }
  return {
    severity: "critical",
    actions: [
      "Do not run. Use bear spray if available, protect your neck, and fight back if the attack is persistent or predatory.",
      "Species and motive are uncertain; call for emergency help as soon as you can do so safely.",
      spray,
    ],
  };
}

/** NPS mountain-lion guidance: do not run or crouch; make yourself large, maintain eye contact, and fight back if attacked. */
export function cougarEncounter(input: {
  behavior: "observed" | "approaching" | "attacking";
}): WildlifeEncounter {
  if (input.behavior === "observed") {
    return {
      severity: "caution",
      actions: [
        "Keep the cougar in view, pick up small children without crouching, and back away slowly.",
        "Do not run, crouch, or turn your back. Make yourself look large and maintain eye contact.",
      ],
    };
  }
  if (input.behavior === "approaching") {
    return {
      severity: "warning",
      actions: [
        "Face it, make yourself large, maintain eye contact, speak firmly, and throw objects if needed.",
        "Do not run or crouch. Give it a route away while keeping the group together.",
      ],
    };
  }
  return {
    severity: "critical",
    actions: [
      "Fight back aggressively with hands, rocks, poles, or any available tool; protect head and neck.",
      "Do not run or crouch. Get emergency help as soon as the immediate danger ends.",
    ],
  };
}

/** NPS moose-safety guidance: moose injure more people than bears in some regions. Unlike a bear encounter, run from a charge and get behind a large tree or solid obstacle. */
export function mooseEncounter(input: {
  behavior: "observed" | "ears-back" | "charging";
}): WildlifeEncounter {
  if (input.behavior === "observed") {
    return {
      severity: "caution",
      actions: [
        "Moose injure more people than bears in some regions. Stay at least the local required distance away and keep dogs controlled.",
        "Never get between a cow and calf or approach a bull; leave it a wide route.",
      ],
    };
  }
  if (input.behavior === "ears-back") {
    return {
      severity: "warning",
      actions: [
        "Ears back, raised hackles, or licking lips can signal agitation. Back away immediately and put trees or terrain between you and the moose.",
        "Do not stand your ground as you would with a bear.",
      ],
    };
  }
  return {
    severity: "critical",
    actions: [
      "Run and get behind a large tree, vehicle, or other solid obstacle; unlike bear doctrine, create distance fast.",
      "If knocked down, curl into a ball, protect head and neck, and remain still until the moose has moved away.",
    ],
  };
}

/** Wilderness Medical Society snakebite guidance: avoid harmful first-aid myths and evacuate promptly for antivenom assessment. */
export function snakebiteManagement(): { doList: string[]; doNotList: string[] } {
  return {
    doList: [
      "Move away from the snake, keep calm, and limit walking or exertion.",
      "Immobilize the bitten limb in a neutral position at about heart level.",
      "Remove rings, watches, and tight clothing before swelling begins.",
      "Mark the edge of swelling and write the time; note symptoms without handling the snake.",
      "Evacuate promptly to a hospital that can assess for antivenom. Call emergency services when available.",
    ],
    doNotList: [
      "Do not apply a tourniquet or constriction band.",
      "Do not cut, make an incision, or try to bleed the wound.",
      "Do not use suction devices or mouth suction.",
      "Do not apply ice or immerse the limb in cold water.",
      "Do not use electricity or a stun device.",
      "Do not drink alcohol or caffeine as a treatment.",
      "Do not try to catch or kill the snake; a photo from a safe distance is enough if it can be obtained safely.",
    ],
  };
}

/** CDC tick guidance: use fine-tipped tweezers close to the skin and a steady pull; burning, petroleum jelly, and twisting delay removal or increase risk. */
export function tickRemoval(): string[] {
  return [
    "Use clean, fine-tipped tweezers. Grasp the tick as close to the skin as possible, at the head or mouthparts.",
    "Pull upward with steady, even pressure. Do not twist or jerk.",
    "Clean the bite and hands with soap and water or an appropriate antiseptic.",
    "Do not burn the tick, cover it with petroleum jelly, or use nail polish or chemicals to make it detach.",
    "If practical, save the tick in a sealed container or take a clear photo for identification; note the date and location.",
  ];
}

/** CDC tickborne-disease guidance: early symptoms can be nonspecific; fever, rash, or flu-like illness after a tick bite warrants timely clinical advice. */
export function tickDiseaseWatch(): string[] {
  return [
    "Watch for expanding rash, fever, chills, headache, fatigue, muscle or joint aches, or swollen lymph nodes in the next days to weeks.",
    "A bull's-eye rash can occur with Lyme disease, but not every tickborne illness causes that pattern.",
    "Seek medical advice promptly for fever, rash, facial weakness, severe headache, or new illness after a tick bite; say when and where exposure occurred.",
  ];
}

/** Interagency Grizzly Bear Committee and NPS food-storage guidance: use a park-required hard-sided, IGBC-recognized canister when required; odor-proof bags alone do not prevent animal access. */
export function foodStorage(): string[] {
  return [
    "Follow the local land-manager rule first. Where required, use a hard-sided, park-approved or IGBC-recognized bear-resistant canister for all scented items.",
    "Where a proper hang is allowed and no canister is required, suspend food at least 3.7 m (12 ft) above ground and 1.8 m (6 ft) out from the trunk and supporting limb.",
    "Use the camp triangle: keep sleeping, cooking, and food-storage areas separate, commonly about 90 m (100 yd) apart where terrain and regulations allow.",
    "Store food, trash, cookware, toothpaste, sunscreen, and other scented items; clean up immediately after cooking.",
    "Odor-proof bags alone are not bear-resistant storage. They may reduce odor but do not stop an animal from taking or crushing the bag.",
  ];
}

/** NPS wildlife-viewing rules commonly require at least 100 m from bears and wolves and 25 m from other large wildlife; posted local rules override this baseline. */
export function wildlifeDistances(): Array<{ animal: string; minimumMeters: number; note: string }> {
  return [
    { animal: "Bears", minimumMeters: 100, note: "At least 100 m; give more space if the bear changes behavior or has cubs." },
    { animal: "Wolves", minimumMeters: 100, note: "At least 100 m; never feed or approach." },
    { animal: "Moose", minimumMeters: 25, note: "At least 25 m in many parks; much farther if ears are back, calves are present, or it is in the trail." },
    { animal: "Bison, elk, deer, and other large wildlife", minimumMeters: 25, note: "At least 25 m in many US parks; local rules may require more." },
  ];
}
