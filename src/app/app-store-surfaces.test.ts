import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The submission-blocking facts, asserted against the files a reviewer reads.
 * Each of these was a real finding: a purpose string that contradicted the code,
 * a required submission URL that did not exist, and an install-from-Safari card
 * rendering inside the shipped app on the exact screen the review notes send the
 * reviewer to.
 */
const PLIST = readFileSync("ios/App/App/Info.plist", "utf8");
const MANIFEST = readFileSync("ios/App/App/PrivacyInfo.xcprivacy", "utf8");
const HINT = readFileSync("src/components/offline/install-offline-hint.tsx", "utf8");

describe("what App Review will look at", () => {
  it("has the privacy policy and terms pages a submission requires", () => {
    expect(existsSync("src/app/privacy/page.tsx")).toBe(true);
    expect(existsSync("src/app/terms/page.tsx")).toBe(true);
    const terms = readFileSync("src/app/terms/page.tsx", "utf8");
    // Guideline 1.4.1: the app must not read as a substitute for a real beacon.
    expect(terms).toMatch(/not.{0,20}a substitute for a personal locator beacon/i);
    expect(terms).toMatch(/cannot call for help/i);
  });

  it("does not claim in the permission dialog that location stays on the phone", () => {
    // src/lib/offline/index.ts POSTs {lat,lng,elevation,recordedAt} batches to
    // the app's own API, so this claim was false where it mattered most. Read the
    // purpose strings themselves — an XML comment explaining the old wording is
    // not something a user ever sees.
    const purposeStrings = [...PLIST.matchAll(/<key>(NSLocation\w+)<\/key>\s*<string>([^<]*)<\/string>/g)]
      .map((match) => ({ key: match[1], value: match[2] }));
    expect(purposeStrings.length).toBeGreaterThanOrEqual(2);
    for (const { value } of purposeStrings) {
      expect(value).not.toMatch(/never leaves the device/i);
      expect(value).not.toMatch(/stays? on (?:the|this) phone\b(?!.*upload)/i);
    }
    expect(purposeStrings.map((s) => s.key)).toContain("NSLocationWhenInUseUsageDescription");
    expect(purposeStrings.some((s) => /uploaded to Klandagi's own server/.test(s.value))).toBe(true);
  });

  it("declares uploaded location as linked, because the identifier is stable", () => {
    expect(MANIFEST).not.toMatch(/NSPrivacyCollectedDataTypeLinked<\/key>\s*<false\/>/);
    // Tracking is genuinely false and must stay that way.
    expect(MANIFEST).toMatch(/NSPrivacyCollectedDataTypeTracking<\/key>\s*<false\/>/);
  });

  it("keeps the install-from-Safari card out of the native shell", () => {
    expect(HINT).toContain("isNative()");
    expect(HINT).toMatch(/if \(isNative\(\)\) return true;/);
  });

  it("stays portrait-only, which is what the compass and the HUD were written for", () => {
    // The web manifest pins portrait and device-heading.ts refuses samples at any
    // other screen orientation; the port had widened this without widening either.
    const orientations = PLIST.slice(
      PLIST.indexOf("<key>UISupportedInterfaceOrientations</key>"),
      PLIST.indexOf("<key>UISupportedInterfaceOrientations~ipad</key>"),
    );
    expect(orientations).not.toContain("LandscapeLeft");
    expect(orientations).toContain("UIInterfaceOrientationPortrait");
  });

  it("corrects the magnetometer for how the phone is being held", () => {
    const plugin = readFileSync("ios/App/App/HeadingPlugin.swift", "utf8");
    expect(plugin).toContain("headingOrientation");
    expect(plugin).toContain("orientationDidChangeNotification");
  });
});

/**
 * The listing used to instruct "answer None to all objectionable-content
 * questions" against a tab containing tourniquet conversion timing and snare
 * construction. An inaccurate age rating is a 2.3.6 metadata violation and is
 * checkable by anyone who opens the app.
 */
describe("the store metadata describes the app that exists", () => {
  const storeDoc = readFileSync(resolve(process.cwd(), "docs/app-store.md"), "utf8");

  it("no longer tells anyone to file None to everything", () => {
    expect(storeDoc).not.toMatch(/answer "None" to all objectionable-content questions/);
  });

  it("names the content the questionnaire is actually asking about", () => {
    expect(storeDoc).toMatch(/Medical and treatment information/i);
    expect(storeDoc).toMatch(/Realistic violence/i);
    expect(storeDoc).toMatch(/2\.3\.6/);
  });

  it("gives the 2.5.4 battery notice a real string to point at", () => {
    expect(storeDoc).toMatch(/2\.5\.4/);
    const recorder = readFileSync(
      resolve(process.cwd(), "src/components/activities/activity-recorder.tsx"),
      "utf8",
    );
    expect(recorder).toMatch(/uses the battery\s*\n?\s*noticeably faster/);
    // Before the tap, not after it.
    expect(recorder.indexOf("noticeably faster")).toBeLessThan(recorder.indexOf("Start recording"));
  });
});

/**
 * The roadmap conceded that no terrain tiles are downloaded; the app did not,
 * except in the failure branch of one readiness row. "Nearby context saved"
 * reads as "the map is on the phone", and the thing that is not on the phone is
 * the shape of the ground.
 */
describe("the app concedes its two biggest limits where a user will read them", () => {
  it("says there is no terrain in the guide, the readiness list, and the listing", () => {
    for (const [name, path] of [
      ["guide", "src/app/guide/page.tsx"],
      ["readiness", "src/components/offline/offline-readiness.tsx"],
      ["listing", "docs/app-store.md"],
    ] as const) {
      const source = readFileSync(resolve(process.cwd(), path), "utf8");
      expect(source, `${name} does not mention the missing terrain`).toMatch(
        /contours|shaded relief/i,
      );
    }
  });

  it("says it follows one phone, not a party, in the guide and the listing", () => {
    for (const path of ["src/app/guide/page.tsx", "docs/app-store.md"]) {
      expect(readFileSync(resolve(process.cwd(), path), "utf8")).toMatch(
        /one phone, not a party/i,
      );
    }
  });
});
