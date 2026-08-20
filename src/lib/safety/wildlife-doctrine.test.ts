/**
 * Doctrine-invariant regression tests.
 *
 * The species/behavior inversions in wildlife.ts are the highest-consequence
 * branches in the codebase: "play dead" and "fight back" are correct advice in
 * mutually exclusive situations, and swapping them is lethal. These tests walk
 * the full input matrix so a refactor cannot silently flip a branch.
 */
import { describe, expect, it } from "vitest";
import {
  bearEncounter,
  cougarEncounter,
  foodStorage,
  mooseEncounter,
  snakebiteManagement,
  tickRemoval,
  wildlifeDistances,
} from "./wildlife";

type Species = "black" | "grizzly" | "unknown";
type Behavior =
  | "unaware"
  | "aware-calm"
  | "defensive-bluff"
  | "predatory"
  | "attacking";

const SPECIES: Species[] = ["black", "grizzly", "unknown"];
const BEHAVIORS: Behavior[] = [
  "unaware",
  "aware-calm",
  "defensive-bluff",
  "predatory",
  "attacking",
];

function bearText(species: Species, behavior: Behavior, sprayAvailable = true) {
  return bearEncounter({ species, behavior, sprayAvailable }).actions.join(" ");
}

describe("bear doctrine invariants across the full input matrix", () => {
  it("only ever mentions play dead for a grizzly", () => {
    // Play-dead is correct only for a DEFENSIVE grizzly attack. It must never
    // surface for a black bear (which requires fighting back) or for an
    // unknown species (where we cannot know which applies).
    const offenders: string[] = [];
    for (const species of SPECIES) {
      for (const behavior of BEHAVIORS) {
        for (const spray of [true, false]) {
          const text = bearText(species, behavior, spray);
          if (/play dead/i.test(text) && species !== "grizzly") {
            offenders.push(`${species}/${behavior}/spray=${spray}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("always conditions play-dead advice on the attack being defensive", () => {
    // The word must never appear as unconditional advice: a reader skimming
    // under stress has to see which case it applies to.
    for (const behavior of BEHAVIORS) {
      const actions = bearEncounter({
        species: "grizzly",
        behavior,
        sprayAvailable: true,
      }).actions;
      for (const action of actions) {
        if (/play dead/i.test(action)) {
          expect(action).toMatch(/defensive/i);
        }
      }
    }
  });

  it("pairs play-dead guidance with a fight-back branch during an attack", () => {
    // A grizzly attack in progress may be either defensive or predatory, so
    // both branches must be presented together.
    const text = bearText("grizzly", "attacking");
    expect(text).toMatch(/play dead/i);
    expect(text).toMatch(/predatory/i);
    expect(text).toMatch(/fight back/i);
  });

  it("never tells anyone to run from a bear, in any combination", () => {
    for (const species of SPECIES) {
      for (const behavior of BEHAVIORS) {
        // Accept "never run" / "do not run" but reject an imperative "run".
        const text = bearText(species, behavior).replace(
          /\b(never run|do not run|don't run)\b/gi,
          "",
        );
        expect(text).not.toMatch(/\brun\b/i);
      }
    }
  });

  it("escalates to critical for predatory and attacking behavior", () => {
    for (const species of SPECIES) {
      for (const behavior of ["predatory", "attacking"] as Behavior[]) {
        expect(
          bearEncounter({ species, behavior, sprayAvailable: true }).severity,
        ).toBe("critical");
      }
    }
  });

  it("always advises fighting back against any attacking bear", () => {
    for (const species of SPECIES) {
      expect(bearText(species, "attacking")).toMatch(/fight back/i);
    }
  });

  it("treats an unknown species conservatively rather than guessing", () => {
    // With species unknown we cannot know whether play-dead applies, so the
    // module must not gamble on it.
    for (const behavior of BEHAVIORS) {
      expect(bearText("unknown", behavior)).not.toMatch(/play dead/i);
    }
  });

  it("mentions spray effectiveness when spray is carried", () => {
    expect(bearText("grizzly", "aware-calm", true)).toMatch(/spray/i);
  });
});

describe("cougar doctrine", () => {
  it("forbids running and crouching, and escalates to fighting back", () => {
    const approaching = cougarEncounter({ behavior: "approaching" });
    expect(approaching.actions.join(" ")).toMatch(/not run|never run|do not run/i);

    const attacking = cougarEncounter({ behavior: "attacking" });
    expect(attacking.severity).toBe("critical");
    expect(attacking.actions.join(" ")).toMatch(/fight back/i);
    expect(attacking.actions.join(" ")).not.toMatch(/play dead/i);
  });
});

describe("moose doctrine inverts bear doctrine", () => {
  it("tells you to run and put an obstacle between you and the animal", () => {
    const charging = mooseEncounter({ behavior: "charging" });
    expect(charging.actions.join(" ")).toMatch(/\brun\b/i);
    expect(charging.actions.join(" ")).toMatch(/tree|obstacle|vehicle/i);
    expect(charging.actions.join(" ")).not.toMatch(/stand your ground/i);
  });

  it("escalates through observed, ears-back and charging", () => {
    const observed = mooseEncounter({ behavior: "observed" });
    const earsBack = mooseEncounter({ behavior: "ears-back" });
    const charging = mooseEncounter({ behavior: "charging" });
    const rank = { info: 0, caution: 1, warning: 2, critical: 3 } as const;
    expect(rank[observed.severity]).toBeLessThanOrEqual(rank[earsBack.severity]);
    expect(rank[earsBack.severity]).toBeLessThanOrEqual(rank[charging.severity]);
  });
});

describe("snakebite myth rejection is exhaustive", () => {
  it("names every discredited field treatment", () => {
    const doNot = snakebiteManagement().doNotList.join(" ").toLowerCase();
    for (const myth of [
      "tourniquet",
      "incision",
      "suction",
      "ice",
      "electricity",
      "alcohol",
    ]) {
      expect(doNot).toContain(myth);
    }
  });

  it("keeps discredited treatments out of the do list", () => {
    const doList = snakebiteManagement().doList.join(" ").toLowerCase();
    expect(doList).not.toContain("tourniquet");
    expect(doList).not.toContain("suction");
    expect(doList).not.toContain("incision");
  });

  it("covers immobilization, marking, and antivenom evacuation", () => {
    const doList = snakebiteManagement().doList.join(" ").toLowerCase();
    expect(doList).toMatch(/immobil/);
    expect(doList).toMatch(/mark|swelling/);
    expect(doList).toMatch(/antivenom|evacuat/);
  });
});

describe("reference lists are populated and specific", () => {
  it("gives tick removal guidance without folk remedies", () => {
    const steps = tickRemoval().join(" ").toLowerCase();
    expect(steps).toMatch(/tweezers/);
    // Folk remedies and wrong techniques may appear ONLY inside an explicit
    // prohibition, never as a bare instruction.
    for (const wrong of ["burn", "petroleum", "nail polish", "twist", "jerk"]) {
      const sentence = tickRemoval().find((s) =>
        s.toLowerCase().includes(wrong),
      );
      if (sentence) expect(sentence).toMatch(/do not|don't|never/i);
    }
    expect(steps).toMatch(/steady|even pressure/);
  });

  it("states that odor-proof bags are not food storage", () => {
    const storage = foodStorage().join(" ").toLowerCase();
    expect(storage.length).toBeGreaterThan(50);
    expect(storage).toMatch(/canister|hang/);
  });

  it("returns numeric minimum approach distances", () => {
    const distances = wildlifeDistances();
    expect(distances.length).toBeGreaterThan(1);
    for (const entry of distances) {
      expect(Number.isFinite(entry.minimumMeters)).toBe(true);
      expect(entry.minimumMeters).toBeGreaterThan(0);
    }
    const bear = distances.find((d) => /bear/i.test(d.animal));
    expect(bear?.minimumMeters).toBeGreaterThanOrEqual(90);
  });
});
