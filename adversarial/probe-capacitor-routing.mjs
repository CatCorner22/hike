import { existsSync, readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";

/**
 * Proves the static export can actually be served inside the iOS shell.
 *
 * Capacitor resolves every asset request through its Router. The stock
 * CapacitorRouter answers ANY extensionless path with the root index.html, so a
 * multi-document Next export is invisible to it — including on the reload
 * Capacitor performs after WKWebView's content process is killed, which is how
 * a hiker silently loses the navigate screen mid-hike.
 *
 * ios/App/App/MainViewController.swift replaces it with StaticExportRouter.
 * `routeFor` below is that rule, transcribed. This probe checks two things the
 * Swift cannot check for itself: the rule is right, and the export on disk is
 * still shaped the way the rule assumes.
 */
const OUT = process.env.EXPORT_DIR ?? "out";
const BASE_PATH = "/bundle/public";

/** Port of StaticExportRouter.route(for:) — keep the two in step. */
export function routeFor(path, basePath, exists) {
  const rootDocument = `${basePath}/index.html`;
  const lastSegment = path.split("/").pop() ?? "";
  const hasExtension = lastSegment.includes(".") && !lastSegment.startsWith(".");
  if (hasExtension) return basePath + path;
  if (path.includes("..")) return rootDocument;
  const directory = path.replace(/\/+$/, "");
  if (!directory) return rootDocument;
  const candidate = `${basePath}${directory}/index.html`;
  return exists(candidate) ? candidate : rootDocument;
}

const results = [];
function check(name, actual, expected) {
  const pass = actual === expected;
  results.push({ name, pass, actual, expected });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : ` :: got ${actual}, want ${expected}`}`);
}

// --- the rule, against a fixed pretend bundle -------------------------------
const present = new Set([
  `${BASE_PATH}/index.html`,
  `${BASE_PATH}/navigate/index.html`,
  `${BASE_PATH}/plan/detail/index.html`,
]);
const pretend = (candidate) => present.has(candidate);

check("root path serves the root document", routeFor("/", BASE_PATH, pretend), `${BASE_PATH}/index.html`);
check("a route directory serves its own document", routeFor("/navigate/", BASE_PATH, pretend), `${BASE_PATH}/navigate/index.html`);
check("the same route without a trailing slash resolves too", routeFor("/navigate", BASE_PATH, pretend), `${BASE_PATH}/navigate/index.html`);
check("a nested route resolves", routeFor("/plan/detail/", BASE_PATH, pretend), `${BASE_PATH}/plan/detail/index.html`);
check("an unknown route falls back to the root document", routeFor("/nope/", BASE_PATH, pretend), `${BASE_PATH}/index.html`);
check("a real asset keeps Capacitor's own behaviour", routeFor("/_next/static/chunk.js", BASE_PATH, pretend), `${BASE_PATH}/_next/static/chunk.js`);
// A traversal attempt must never be concatenated onto the bundle path.
check("traversal is refused", routeFor("/../../etc/passwd", BASE_PATH, pretend), `${BASE_PATH}/index.html`);
check("traversal with a trailing slash is refused", routeFor("/navigate/../../..", BASE_PATH, pretend), `${BASE_PATH}/index.html`);

// --- the export on disk -----------------------------------------------------
if (!existsSync(OUT)) {
  console.error(`\nNo ${OUT}/ directory — run \`npm run build:cap\` first.`);
  process.exit(1);
}

async function documentDirectories(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "_next") continue;
    const child = join(dir, entry.name);
    if (existsSync(join(child, "index.html"))) found.push(child);
    found.push(...(await documentDirectories(child)));
  }
  return found;
}

const directories = await documentDirectories(OUT);
const onDisk = (candidate) => existsSync(join(OUT, candidate.slice(BASE_PATH.length + 1)));

let routeFailures = 0;
for (const directory of directories) {
  const urlPath = `/${relative(OUT, directory).split(sep).join("/")}/`;
  const resolved = routeFor(urlPath, BASE_PATH, onDisk);
  const want = `${BASE_PATH}${urlPath}index.html`;
  if (resolved !== want) {
    console.log(`FAIL export route ${urlPath} :: got ${resolved}, want ${want}`);
    routeFailures += 1;
  }
}
console.log(
  `${routeFailures ? "FAIL" : "PASS"} every exported route resolves to its own document :: ${directories.length - routeFailures}/${directories.length}`,
);

// The navigate document is the one whose loss is a field-safety event, and the
// root document is what the stock router would have served in its place. If the
// two were interchangeable none of this would matter — assert that they are not.
const MARKER = 'data-hike-navigate-shell="shell"';
const navigateDocument = join(OUT, "navigate", "index.html");
const navigateMarked = existsSync(navigateDocument) && readFileSync(navigateDocument, "utf8").includes(MARKER);
const rootMarked = readFileSync(join(OUT, "index.html"), "utf8").includes(MARKER);
check("the navigate document carries the shell marker", navigateMarked, true);
check("the root document does NOT (so serving it instead is a real failure)", rootMarked, false);

// --- what the export build left behind ---------------------------------------
// `distDir: ".next-cap"` redirects the export, but Next still writes its
// compiled build to the default `.next`. Left there, it makes `next start`
// serve a server with no API routes and trailingSlash on — every API call
// answers with a redirect or a 404 while the app looks like it is running, and
// the symptom reads as an application bug. scripts/build-capacitor.mjs puts the
// web build back (or removes the export's) precisely so this cannot happen.
const serverFiles = ".next/required-server-files.json";
if (existsSync(serverFiles)) {
  const config = JSON.parse(readFileSync(serverFiles, "utf8")).config ?? {};
  check("the export build did not leave its server build in .next", config.output !== "export", true);
} else {
  check("no .next remains for `next start` to serve by mistake", true, true);
}

const failed = results.filter((r) => !r.pass).length + routeFailures;
console.log(`\nSUMMARY routes=${directories.length} failed=${failed}`);
process.exitCode = failed ? 1 : 0;
