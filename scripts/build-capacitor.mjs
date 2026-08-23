#!/usr/bin/env node
/**
 * Static-shell build for the Capacitor iOS app.
 *
 * Server-only API route handlers are excluded by extension (route.api.ts is
 * invisible to the capacitor pageExtensions), but the proxy cannot be: Next's
 * proxy detection compares `path.parse(file).name === "proxy"`, and any
 * compound extension makes the name "proxy.api", so a renamed proxy is never
 * discovered by the WEB build either. The export build instead moves
 * src/proxy.ts aside for the duration of the build and always restores it —
 * on success, failure, and signals — so the working tree ends unchanged.
 *
 * `.next` gets the same treatment, for a reason that is not obvious: setting
 * `distDir: ".next-cap"` redirects the EXPORT, but Next still writes its
 * compiled build to the default `.next`. So a capacitor build silently replaces
 * whatever web build was there with one that has `output: "export"`,
 * `trailingSlash: true` and no API routes at all — and the next `next start`
 * serves that, answering every API call with a redirect or a 404 while looking
 * like a running app. That failure reads as an application bug and has cost
 * real debugging time. Move the web build aside, let the export build have its
 * own `.next`, then discard it and put the web build back.
 */
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const asideDir = path.join(root, ".cap-build-aside");
// The test moves with its subject: the export build type-checks the whole
// project, and an orphaned src/proxy.test.ts fails on its "./proxy" import.
const ASIDE_FILES = [
  { source: path.join(root, "src", "proxy.ts"), aside: path.join(asideDir, "proxy.ts") },
  { source: path.join(root, "src", "proxy.test.ts"), aside: path.join(asideDir, "proxy.test.ts") },
];

for (const file of ASIDE_FILES) {
  if (existsSync(file.aside)) {
    // A previous run died between move and restore. Put the tree right first.
    renameSync(file.aside, file.source);
    console.error(`build:cap: restored ${path.relative(root, file.source)} left aside by an interrupted build`);
  }
}

const moved = [];
mkdirSync(asideDir, { recursive: true });
for (const file of ASIDE_FILES) {
  if (existsSync(file.source)) {
    renameSync(file.source, file.aside);
    moved.push(file);
  }
}

// The web build, if there is one, waits out the export next to the proxy.
const webBuild = path.join(root, ".next");
const webBuildAside = path.join(asideDir, "next-web-build");
if (existsSync(webBuildAside)) {
  rmSync(webBuild, { recursive: true, force: true });
  renameSync(webBuildAside, webBuild);
  console.error("build:cap: restored the .next web build left aside by an interrupted build");
}
if (existsSync(webBuild)) renameSync(webBuild, webBuildAside);

let restored = false;
const restore = () => {
  if (restored) return;
  restored = true;
  for (const file of moved) {
    if (existsSync(file.aside)) renameSync(file.aside, file.source);
  }
  // Whatever the export build put in .next describes a server that cannot serve
  // this app. Never leave it where `next start` will find it.
  rmSync(webBuild, { recursive: true, force: true });
  if (existsSync(webBuildAside)) renameSync(webBuildAside, webBuild);
};
process.on("exit", restore);
process.on("SIGINT", () => {
  restore();
  process.exit(130);
});
process.on("SIGTERM", () => {
  restore();
  process.exit(143);
});

try {
  const result = spawnSync("npx", ["next", "build", "--webpack"], {
    stdio: "inherit",
    env: { ...process.env, BUILD_TARGET: "capacitor" },
  });
  if (result.status === 0) {
    // With output:"export", distDir IS the export destination (docs:
    // "Change the output directory out -> dist"), so the site lands in
    // .next-cap. Publish it at the stable out/ path every consumer uses
    // (capacitor webDir, CI checks, the runbook).
    const exportDir = path.join(root, ".next-cap");
    const outDir = path.join(root, "out");
    if (!existsSync(path.join(exportDir, "index.html"))) {
      console.error("build:cap: export completed but .next-cap/index.html is missing");
      process.exit(1);
    }
    rmSync(outDir, { recursive: true, force: true });
    renameSync(exportDir, outDir);
  }
  process.exit(result.status ?? 1);
} finally {
  restore();
}
