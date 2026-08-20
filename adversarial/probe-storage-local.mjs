/**
 * Local JSON fallback and offline-point-queue probe.
 * Run: node adversarial/probe-storage-local.mjs
 */
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const ROOT = process.cwd();
const DIR = path.join(ROOT, "adversarial", `scratch-storage-local-${Date.now()}`);
const STORE = path.join(DIR, "store.json");

function runTsx(code, env = {}) {
  return new Promise((resolve, reject) => {
    const lines = code.trim().split("\n");
    const imports = lines.filter((line) => line.trim().startsWith("import "));
    const body = lines.filter((line) => !line.trim().startsWith("import ")).join("\n");
    const executable = `${imports.join("\n")}\n;(async () => {${body}})().catch((error) => { console.error(error); process.exitCode = 1; });`;
    const child = spawn("npx", ["tsx", "-e", executable], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (status) => resolve({ status, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

function log(name, pass, detail) {
  console.log(`${pass ? "PASS" : "FAIL"} ${name} — ${detail}`);
}

async function main() {
  await mkdir(DIR, { recursive: true });

  // Truncated JSON must never be replaced by a fresh empty object.
  await writeFile(STORE, '{"plans": [');
  const malformed = await runTsx(
    `import { createPlan } from "./src/lib/store/local.ts";
     try { await createPlan({ownerId:"probe",name:"must not overwrite"}); console.log("UNEXPECTED_SUCCESS"); }
     catch (error) { console.log("REJECTED", error.constructor.name); }`,
    { LOCAL_STORE_PATH: STORE },
  );
  const malformedRaw = await readFile(STORE, "utf8");
  log("truncated-json-preserved", malformed.stdout.startsWith("REJECTED") && malformedRaw === '{"plans": [', `status=${malformed.status}; ${malformed.stdout}; ${malformed.stderr}; bytes=${malformedRaw.length}`);

  // A crash before rename leaves a temporary sibling; the old data remains authoritative.
  const good = {
    plans: [{
      id: "good-plan", ownerId: "probe", name: "Good map", trailId: null, plannedDate: null, notes: null,
      waypoints: null, campgroundIds: [], customGeometry: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    }],
    activities: [], points: [],
  };
  await writeFile(STORE, JSON.stringify(good));
  await writeFile(`${STORE}.crash-between-write-and-rename.tmp`, '{"plans": [');
  const crash = await runTsx(
    `import { listPlans } from "./src/lib/store/local.ts";
     console.log((await listPlans("probe")).map(p => p.name).join("|"));`,
    { LOCAL_STORE_PATH: STORE },
  );
  log("temp-file-crash-keeps-good-store", crash.stdout === "Good map", `status=${crash.status}; ${crash.stdout}; ${crash.stderr}`);

  // A valid but incorrectly-shaped envelope containing a real plan must be
  // preserved rather than treated as an empty store and overwritten.
  await writeFile(STORE, JSON.stringify({ data: good }));
  const wrongShape = await runTsx(
    `import { createPlan } from "./src/lib/store/local.ts";
     try { await createPlan({ownerId:"probe",name:"after malformed shape"}); console.log("UNEXPECTED_SUCCESS"); }
     catch (error) { console.log("REJECTED", error.constructor.name); }`,
    { LOCAL_STORE_PATH: STORE },
  );
  const wrongShapeRaw = await readFile(STORE, "utf8");
  log(
    "valid-wrong-shape-is-preserved",
    wrongShape.stdout === "REJECTED LocalStoreCorruptionError" && wrongShapeRaw === JSON.stringify({ data: good }),
    `status=${wrongShape.status}; ${wrongShape.stdout}; ${wrongShape.stderr}; preserved=${wrongShapeRaw === JSON.stringify({ data: good })}`,
  );

  // Directory denial must reject instead of replacing the existing file.
  await writeFile(STORE, JSON.stringify(good));
  await chmod(DIR, 0o555);
  const readonly = await runTsx(
    `import { createPlan } from "./src/lib/store/local.ts";
     try { await createPlan({ownerId:"probe",name:"cannot write"}); console.log("UNEXPECTED_SUCCESS"); }
     catch (error) { console.log("REJECTED", error.code ?? error.constructor.name); }`,
    { LOCAL_STORE_PATH: STORE },
  );
  // Restore only so the containing workspace remains readable/writable to later agents;
  // the evidence directory and all files intentionally remain in place.
  await chmod(DIR, 0o755);
  const readonlyRaw = await readFile(STORE, "utf8");
  log("read-only-directory-preserves-good-store", readonly.stdout.startsWith("REJECTED") && readonlyRaw === JSON.stringify(good), `status=${readonly.status}; ${readonly.stdout}; ${readonly.stderr}; unchanged=${readonlyRaw === JSON.stringify(good)}`);

  // The recording queue must retain enough capacity for a maximum-size route pack.
  const queue = await runTsx(
    `import "fake-indexeddb/auto";
     import { MAX_PENDING_POINT_COUNT, queueActivityPoint, getPendingPointCount, __resetOfflineDbForTests } from "./src/lib/offline/index.ts";
     await __resetOfflineDbForTests();
     for (let i = 0; i < MAX_PENDING_POINT_COUNT; i++) await queueActivityPoint({activityId:"queue-probe",lat:40+i/1e6,lng:-105,recordedAt:new Date(1700000000000+i)});
     try { await queueActivityPoint({activityId:"queue-probe",lat:41,lng:-105,recordedAt:new Date()}); }
     catch (error) { console.log("PENDING", await getPendingPointCount(), "REJECTED", error.name); }`,
  );
  log("point-queue-reserves-route-pack-space", queue.stdout === "PENDING 2000 REJECTED OfflinePointQueueFullError", `status=${queue.status}; ${queue.stdout}; ${queue.stderr}`);

  // At a storage write failure, the queue rejects with a recorder-safe message
  // rather than silently pretending the current point was stored.
  const queueFailure = await runTsx(
    `import "fake-indexeddb/auto";
     import { queueActivityPoint, __resetOfflineDbForTests } from "./src/lib/offline/index.ts";
     await __resetOfflineDbForTests();
     const put = IDBObjectStore.prototype.put;
     IDBObjectStore.prototype.put = function(){ throw new DOMException("probe full", "QuotaExceededError"); };
     try { await queueActivityPoint({activityId:"queue-probe",lat:40,lng:-105,recordedAt:new Date()}); console.log("UNEXPECTED_SUCCESS"); }
     catch (error) { console.log("REJECTED", error.name, error.message); }
     finally { IDBObjectStore.prototype.put = put; }`,
  );
  log("queue-quota-reaches-recorder", /^REJECTED OfflinePointQueueFullError GPS point was not saved because offline storage is full\./.test(queueFailure.stdout), `status=${queueFailure.status}; ${queueFailure.stdout}; ${queueFailure.stderr}`);
}

main().catch((error) => {
  console.error("FATAL", error?.stack ?? error);
  process.exitCode = 1;
});
