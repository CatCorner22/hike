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
  return pass;
}

async function main() {
  await mkdir(DIR, { recursive: true });
  let failed = 0;

  // Truncated JSON must never be replaced by a fresh empty object.
  await writeFile(STORE, '{"plans": [');
  const malformed = await runTsx(
    `import { createPlan } from "./src/lib/store/local.ts";
     try { await createPlan({ownerId:"probe",name:"must not overwrite"}); console.log("UNEXPECTED_SUCCESS"); }
     catch (error) { console.log("REJECTED", error.constructor.name); }`,
    { LOCAL_STORE_PATH: STORE },
  );
  const malformedRaw = await readFile(STORE, "utf8");
  if (!log("truncated-json-preserved", malformed.stdout.startsWith("REJECTED") && malformedRaw === '{"plans": [', `status=${malformed.status}; ${malformed.stdout}; ${malformed.stderr}; bytes=${malformedRaw.length}`)) failed += 1;

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
  if (!log("temp-file-crash-keeps-good-store", crash.stdout === "Good map", `status=${crash.status}; ${crash.stdout}; ${crash.stderr}`)) failed += 1;

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
  if (
    !log(
      "valid-wrong-shape-is-preserved",
      wrongShape.stdout === "REJECTED LocalStoreCorruptionError" && wrongShapeRaw === JSON.stringify({ data: good }),
      `status=${wrongShape.status}; ${wrongShape.stdout}; ${wrongShape.stderr}; preserved=${wrongShapeRaw === JSON.stringify({ data: good })}`,
    )
  ) failed += 1;

  // Directory denial must reject instead of replacing the existing file.
  //
  // Root ignores the directory's permission bits, so under a root container —
  // which is how these probes are usually run locally — the write succeeds and
  // this case reports a failure that says nothing about the app. A probe that
  // cries wolf in the environment it lives in teaches people to ignore it, so
  // say plainly that the case could not be exercised instead.
  if (process.getuid?.() === 0) {
    console.log(
      "SKIP read-only-directory-preserves-good-store — running as root, which bypasses the directory permission bit. CI runs unprivileged and does exercise this.",
    );
  } else {
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
  if (!log("read-only-directory-preserves-good-store", readonly.stdout.startsWith("REJECTED") && readonlyRaw === JSON.stringify(good), `status=${readonly.status}; ${readonly.stdout}; ${readonly.stderr}; unchanged=${readonlyRaw === JSON.stringify(good)}`)) failed += 1;
  }

  // The recording queue must reject at the device budget without consuming route-pack space.
  // Mock the pending count at the ceiling — inserting 65k points in CI would take minutes.
  const queue = await runTsx(
    `import "fake-indexeddb/auto";
     import { MAX_PENDING_POINT_COUNT, queueActivityPoint, getPendingPointCount, getOfflineDb, __resetOfflineDbForTests } from "./src/lib/offline/index.ts";
     await __resetOfflineDbForTests();
     const db = await getOfflineDb();
     if (!db) throw new Error("fake IndexedDB unavailable");
     const count = db.countFromIndex.bind(db);
     let countCalls = 0;
     db.countFromIndex = async (store, index, key) => {
       countCalls += 1;
       if (countCalls === 1 && index === "by-activity") return 0;
       if (countCalls === 2 && index === "by-synced" && key === 0) return MAX_PENDING_POINT_COUNT;
       return count(store, index, key);
     };
     try { await queueActivityPoint({activityId:"queue-probe",lat:41,lng:-105,recordedAt:new Date()}); console.log("UNEXPECTED_SUCCESS"); }
     catch (error) { console.log("PENDING", await getPendingPointCount(), "REJECTED", error.name); }`,
  );
  if (
    !log(
      "point-queue-reserves-route-pack-space",
      queue.stdout === "PENDING 0 REJECTED OfflinePointQueueFullError",
      `status=${queue.status}; ${queue.stdout}; ${queue.stderr}`,
    )
  ) failed += 1;

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
  if (!log("queue-quota-reaches-recorder", /^REJECTED OfflinePointQueueFullError GPS point was not saved because offline storage is full\./.test(queueFailure.stdout), `status=${queueFailure.status}; ${queueFailure.stdout}; ${queueFailure.stderr}`)) failed += 1;

  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("FATAL", error?.stack ?? error);
  process.exitCode = 1;
});
