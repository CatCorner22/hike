import { describe, expect, it } from "vitest";
import { bearEncounter, mooseEncounter, snakebiteManagement } from "./wildlife";

describe("bear encounter doctrine", () => {
  it("uses play-dead guidance only for defensive grizzly contact", () => {
    const defensive = bearEncounter({
      species: "grizzly",
      behavior: "defensive-bluff",
      sprayAvailable: true,
    });
    expect(defensive.actions.join(" ")).toMatch(/play dead/i);

    const predatory = bearEncounter({
      species: "grizzly",
      behavior: "predatory",
      sprayAvailable: true,
    });
    expect(predatory.actions.join(" ")).toMatch(/fight back/i);
    expect(predatory.actions.join(" ")).not.toMatch(/play dead/i);
  });

  it("never advises play dead for a black bear", () => {
    const bluff = bearEncounter({ species: "black", behavior: "defensive-bluff", sprayAvailable: false });
    const attack = bearEncounter({ species: "black", behavior: "attacking", sprayAvailable: false });
    expect(bluff.actions.join(" ")).not.toMatch(/play dead/i);
    expect(attack.actions.join(" ")).toMatch(/fight back/i);
    expect(attack.actions.join(" ")).not.toMatch(/play dead/i);
  });
});

describe("large animal and snake emergencies", () => {
  it("uses run-and-tree doctrine for a charging moose", () => {
    const response = mooseEncounter({ behavior: "charging" });
    expect(response.severity).toBe("critical");
    expect(response.actions.join(" ")).toMatch(/run/i);
    expect(response.actions.join(" ")).toMatch(/tree/i);
  });

  it("rejects persistent snakebite myths", () => {
    const plan = snakebiteManagement();
    expect(plan.doNotList.join(" ")).toMatch(/tourniquet/i);
    expect(plan.doNotList.join(" ")).toMatch(/incision/i);
    expect(plan.doNotList.join(" ")).toMatch(/suction/i);
    expect(plan.doNotList.join(" ")).toMatch(/electricity/i);
    expect(plan.doList.join(" ")).toMatch(/heart level/i);
  });
});
