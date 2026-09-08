import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PROJECT = resolve(process.cwd(), "ios/App/App.xcodeproj/project.pbxproj");
const APP_DIR = resolve(process.cwd(), "ios/App/App");
const project = readFileSync(PROJECT, "utf8");

/** Every object definition line: `\t\t<24-hex-id> /* Name *​/ = {isa = ...`. */
function definitions(): Array<{ id: string; name: string }> {
  return [...project.matchAll(/^\t\t([0-9A-F]{24}) \/\* (.+?) \*\/ = \{/gm)].map((match) => ({
    id: match[1],
    name: match[2],
  }));
}

/**
 * A pbxproj is a graph keyed by 24-hex identifiers, and it has no integrity
 * check of its own: give two objects the same id and Xcode silently resolves
 * every reference to whichever it parsed first. The second object is not an
 * error, it is simply gone.
 *
 * That is exactly what happened when OverduePlugin.swift was added by hand with
 * ids MainViewController.swift already held. The file sat in the repo, was
 * listed in the Sources phase, and was never compiled — and the only symptom was
 * "cannot find 'OverduePlugin' in scope" from the one line that used it. A
 * plugin added without a call site would have vanished in silence.
 */
describe("the Xcode project graph is internally consistent", () => {
  it("defines every object identifier exactly once", () => {
    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    for (const { id, name } of definitions()) {
      const previous = seen.get(id);
      if (previous) duplicates.push(`${id}: "${previous}" and "${name}"`);
      else seen.set(id, name);
    }
    expect(duplicates).toEqual([]);
  });

  it("resolves every build file to a file reference that exists", () => {
    const declared = new Set(definitions().map((entry) => entry.id));
    const unresolved = [...project.matchAll(/fileRef = ([0-9A-F]{24}) \/\* (.+?) \*\//g)]
      .filter((match) => !declared.has(match[1]))
      .map((match) => `${match[2]} (${match[1]})`);
    expect(unresolved).toEqual([]);
  });

  it("compiles every Swift file that lives in the app target directory", () => {
    // A Swift file present on disk, referenced nowhere, is the silent version of
    // the same failure: no error, no plugin, no symptom until something calls it.
    const onDisk = readdirSync(APP_DIR).filter((name) => name.endsWith(".swift"));
    expect(onDisk.length).toBeGreaterThan(0);
    for (const name of onDisk) {
      expect(project, `${name} is not in the Sources build phase`).toMatch(
        new RegExp(`${name.replace(".", "\\.")} in Sources`),
      );
    }
  });

  it("gives each app-local plugin its own identifiers", () => {
    // Names are the human-readable half of the id; a plugin sharing another
    // file's id is what the first test catches, and this asserts the shape it
    // should have instead.
    for (const swift of ["HeadingPlugin.swift", "OverduePlugin.swift"]) {
      const ref = project.match(
        new RegExp(`([0-9A-F]{24}) /\\* ${swift.replace(".", "\\.")} \\*/ = \\{isa = PBXFileReference`),
      );
      const build = project.match(
        new RegExp(
          `([0-9A-F]{24}) /\\* ${swift.replace(".", "\\.")} in Sources \\*/ = \\{isa = PBXBuildFile; fileRef = ([0-9A-F]{24})`,
        ),
      );
      expect(ref, `${swift} has no file reference`).not.toBeNull();
      expect(build, `${swift} has no build file`).not.toBeNull();
      expect(build![2]).toBe(ref![1]);
      expect(build![1]).not.toBe(ref![1]);
    }
  });
});
