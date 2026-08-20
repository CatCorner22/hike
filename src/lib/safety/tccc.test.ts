import { describe, expect, it } from "vitest";
import {
  casualtyCard,
  chestSealGuidance,
  formatTourniquetMark,
  hemorrhageAction,
  hypothermiaWrapSteps,
  marchPawsSteps,
  shockAssessment,
  tensionPneumothoraxSigns,
  tourniquetStatus,
  triageCategory,
} from "./tccc";

const HOUR = 60 * 60 * 1000;

describe("MARCH-PAWS", () => {
  it("returns all nine civilian wilderness assessment steps in order", () => {
    const steps = marchPawsSteps();
    expect(steps.map((step) => step.letter).join("")).toBe("MARCHPAWS");
    expect(steps).toHaveLength(9);
    expect(steps[0].name).toBe("Massive hemorrhage");
    expect(steps[8].name).toBe("Splinting");
  });
});

describe("tourniquet management", () => {
  it("keeps the conversion window open before the 2-hour boundary", () => {
    const status = tourniquetStatus(0, 119 * 60 * 1000 + 30 * 1000);
    expect(status).toMatchObject({ minutes: 119.5, severity: "warning", conversionWindow: true });
    expect(status?.message).toMatch(/before 2 h/);
  });

  it("flags the exact 2-hour conversion boundary", () => {
    const status = tourniquetStatus(0, 2 * HOUR);
    expect(status).toMatchObject({ minutes: 120, severity: "critical", conversionWindow: false });
    expect(status?.message).toMatch(/2 h preferred conversion window has passed/);
  });

  it("flags the exact 6-hour no-conversion boundary", () => {
    const status = tourniquetStatus(0, 6 * HOUR);
    expect(status).toMatchObject({ minutes: 360, severity: "critical", conversionWindow: false });
    expect(status?.message).toMatch(/Do not convert/);
  });

  it("returns null for NaN, negative, or backwards tourniquet times", () => {
    expect(tourniquetStatus(Number.NaN, 0)).toBeNull();
    expect(tourniquetStatus(-1, 0)).toBeNull();
    expect(tourniquetStatus(100, 99)).toBeNull();
  });

  it("formats a Zulu tourniquet mark and rejects an invalid date", () => {
    expect(formatTourniquetMark(new Date("2026-08-20T14:05:00Z"), "left leg")).toBe(
      "TQ LEFT LEG 1405Z",
    );
    expect(formatTourniquetMark(new Date("invalid"), "left leg")).toBeNull();
  });
});

describe("hemorrhage control", () => {
  it("uses a high-and-tight tourniquet for spurting limb bleeding", () => {
    const result = hemorrhageAction({ bleeding: "spurting", site: "limb" });
    expect(result?.severity).toBe("critical");
    expect(result?.actions.join(" ")).toMatch(/high and tight/);
  });

  it("uses pressure and possible escalation for non-spurting limb bleeding", () => {
    const result = hemorrhageAction({ bleeding: "steady", site: "limb" });
    expect(result).toMatchObject({ severity: "warning" });
    expect(result?.actions.join(" ")).toMatch(/direct pressure/);
  });

  it("packs and applies pressure for junctional bleeding because a tourniquet will not work", () => {
    const result = hemorrhageAction({ bleeding: "spurting", site: "junctional" });
    expect(result?.severity).toBe("critical");
    expect(result?.actions.join(" ")).toMatch(/Pack the wound/);
    expect(result?.actions.join(" ")).toMatch(/will not control/);
  });

  it("uses pressure and immediate evacuation for torso bleeding", () => {
    const result = hemorrhageAction({ bleeding: "steady", site: "torso" });
    expect(result?.severity).toBe("critical");
    expect(result?.actions.join(" ")).toMatch(/direct pressure/);
    expect(result?.actions.join(" ")).toMatch(/immediate evacuation/);
  });

  it("protects the airway for neck bleeding and rejects an invalid branch", () => {
    const result = hemorrhageAction({ bleeding: "oozing", site: "neck" });
    expect(result?.actions.join(" ")).toMatch(/do not use a tourniquet on the neck/i);
    expect(result?.actions.join(" ")).toMatch(/airway/i);
    expect(hemorrhageAction({ bleeding: "invalid" as never, site: "limb" })).toBeNull();
  });
});

describe("shock and chest care", () => {
  it("recognizes an absent radial pulse as shock without a cuff", () => {
    const result = shockAssessment({ radialPulsePresent: false, alteredMental: false });
    expect(result).toMatchObject({ severity: "critical", label: "Shock suspected" });
    expect(result?.actions.join(" ")).toMatch(/evacuate urgently/);
  });

  it("recognizes altered mental status and safely rejects NaN field data", () => {
    expect(shockAssessment({ radialPulsePresent: true, alteredMental: true })?.severity).toBe("critical");
    expect(
      shockAssessment({ radialPulsePresent: true, alteredMental: false, heartRate: Number.NaN }),
    ).toBeNull();
  });

  it("includes required chest-seal and tension-pneumothorax guidance", () => {
    expect(tensionPneumothoraxSigns().join(" ")).toMatch(/worsening shortness of breath/);
    const chest = chestSealGuidance().join(" ");
    expect(chest).toMatch(/vented chest seal/);
    expect(chest).toMatch(/burp the seal/);
    expect(chest).toMatch(/trained-provider skill/);
  });

  it("puts ground insulation first in a hypothermia wrap", () => {
    const wrap = hypothermiaWrapSteps();
    expect(wrap[1]).toMatch(/ground FIRST/);
    expect(wrap.join(" ")).toMatch(/Do not place direct heat on the skin/);
  });
});

describe("casualty documentation and START triage", () => {
  it("formats a copyable DD Form 1380-style civilian casualty card", () => {
    const card = casualtyCard({
      name: "Alex R.",
      time: "1405Z",
      mechanism: "Fall onto rock",
      injuries: "Open lower-leg wound",
      pulse: "radial present",
      resp: "20/min",
      avpu: "A",
      treatments: [{ time: "1406Z", treatment: "Pressure dressing" }],
      tourniquets: [{ limb: "LEFT LEG", time: "1410Z" }],
    });
    expect(card).toContain("CASUALTY CARD / TCCC");
    expect(card).toContain("SIGNS: PULSE radial present / RESP 20/min / AVPU A");
    expect(card).toContain("TREATMENTS: 1406Z Pressure dressing");
    expect(card).toContain("TOURNIQUETS: LEFT LEG 1410Z");
  });

  it("assigns green for walking casualties", () => {
    expect(
      triageCategory({ walking: true, breathing: true, radialPulse: true, obeysCommands: true }),
    ).toMatchObject({ category: "green", label: "Minor / walking wounded" });
  });

  it("assigns black for a casualty not breathing after airway positioning", () => {
    expect(
      triageCategory({ walking: false, breathing: false, radialPulse: false, obeysCommands: false }),
    ).toMatchObject({ category: "black" });
  });

  it("assigns red when a breathing casualty has no radial pulse", () => {
    expect(
      triageCategory({ walking: false, breathing: true, radialPulse: false, obeysCommands: true }),
    ).toMatchObject({ category: "red", label: "Immediate" });
  });

  it("assigns yellow when a non-walking casualty meets the delayed START criteria", () => {
    expect(
      triageCategory({ walking: false, breathing: true, radialPulse: true, obeysCommands: true }),
    ).toMatchObject({ category: "yellow", label: "Delayed" });
  });
});

describe("START triage — respiratory rate", () => {
  // Regression: START makes a respiratory rate over 30 an immediate (red) criterion in
  // its own right. There was no input for it, so a casualty breathing 40/min with a
  // radial pulse who could follow commands was triaged yellow (delayed).
  it("categorizes a respiratory rate over 30 as immediate", () => {
    const base = { walking: false, breathing: true, radialPulse: true, obeysCommands: true };
    expect(triageCategory({ ...base, respiratoryRate: 40 }).category).toBe("red");
    expect(triageCategory({ ...base, respiratoryRate: 31 }).category).toBe("red");
    expect(triageCategory({ ...base, respiratoryRate: 30 }).category).toBe("yellow");
    expect(triageCategory({ ...base, respiratoryRate: 18 }).category).toBe("yellow");
    expect(triageCategory(base).category).toBe("yellow");
  });

  it("keeps walking wounded green and apnoeic casualties black regardless of rate", () => {
    expect(triageCategory({ walking: true, breathing: true, radialPulse: true, obeysCommands: true, respiratoryRate: 40 }).category).toBe("green");
    expect(triageCategory({ walking: false, breathing: false, radialPulse: false, obeysCommands: false, respiratoryRate: 0 }).category).toBe("black");
  });
});
