/**
 * API-only race probes. Run:
 * BASE=http://127.0.0.1:3111 node adversarial/probe-race-api.mjs
 */
const BASE = process.env.BASE ?? "http://127.0.0.1:3111";
const geometry = { type: "LineString", coordinates: [[-119.5383, 37.7749], [-119.5379, 37.7751], [-119.5375, 37.7754]] };
let cookie = "";

async function call(path, method = "GET", data) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(data ? { "content-type": "application/json" } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* surfaced with status if it happens */ }
  return { status: response.status, body, text };
}

async function createPlan(name) {
  const result = await call("/api/plans", "POST", { name, notes: "original notes", customGeometry: geometry });
  if (result.status !== 200) throw new Error(`create plan: ${result.status} ${result.text}`);
  return result.body;
}

async function createActivity(name) {
  const result = await call("/api/activities", "POST", { name, startedAt: "2026-08-20T18:00:00.000Z" });
  if (result.status !== 200) throw new Error(`create activity: ${result.status} ${result.text}`);
  return result.body;
}

const document = await fetch(`${BASE}/plan`, { headers: { accept: "text/html", "sec-fetch-dest": "document" } });
cookie = document.headers.get("set-cookie")?.split(";")[0] ?? "";
if (!cookie) throw new Error("could not mint owner session");

const plan = await createPlan("race-plan-original");
const fullSnapshotA = { name: "changed-in-tab-A", notes: "original notes", waypoints: [], campgroundIds: [], customGeometry: geometry };
const fullSnapshotB = { name: "race-plan-original", notes: "changed-in-tab-B", waypoints: [], campgroundIds: [], customGeometry: geometry };
const planWrites = await Promise.all([
  call(`/api/plans/${plan.id}`, "PATCH", fullSnapshotA),
  call(`/api/plans/${plan.id}`, "PATCH", fullSnapshotB),
]);
const planFinal = await call(`/api/plans/${plan.id}`);
console.log("PLAN_STALE_SNAPSHOT_RACE", JSON.stringify({
  patchStatuses: planWrites.map((r) => r.status),
  finalName: planFinal.body?.name,
  finalNotes: planFinal.body?.notes,
  bothIndependentEditsRetained: planFinal.body?.name === fullSnapshotA.name && planFinal.body?.notes === fullSnapshotB.notes,
}));

const duplicateActivity = await createActivity("race-duplicate");
const duplicate = { lat: 37.775, lng: -119.538, elevation: 1234, recordedAt: "2026-08-20T18:01:01.000Z" };
const duplicatePosts = await Promise.all([
  call(`/api/activities/${duplicateActivity.id}/points`, "POST", duplicate),
  call(`/api/activities/${duplicateActivity.id}/points`, "POST", duplicate),
]);
const duplicateRead = await call(`/api/activities/${duplicateActivity.id}/points?limit=10`);
console.log("POINT_RETRY_DUPLICATION", JSON.stringify({
  postStatuses: duplicatePosts.map((r) => r.status),
  matchingPersistedPoints: (duplicateRead.body?.points ?? []).filter((p) => p.lat === duplicate.lat && p.lng === duplicate.lng && p.recordedAt === duplicate.recordedAt).length,
}));

const tailActivity = await createActivity("race-stale-tail");
for (const point of [
  { lat: 37.7749, lng: -119.5383, recordedAt: "2026-08-20T18:02:00.000Z" },
  { lat: 37.7751, lng: -119.5379, recordedAt: "2026-08-20T18:02:01.000Z" },
]) {
  const response = await call(`/api/activities/${tailActivity.id}/points`, "POST", point);
  if (response.status !== 200) throw new Error(`seed point: ${response.status} ${response.text}`);
}
const finalize = await call(`/api/activities/${tailActivity.id}`, "PATCH", {
  endedAt: "2026-08-20T18:02:02.000Z",
  stats: { distanceMeters: 50, elevationGainMeters: 0, durationSeconds: 2 },
});
const latePoint = await call(`/api/activities/${tailActivity.id}/points`, "POST", {
  lat: 37.7754, lng: -119.5375, recordedAt: "2026-08-20T18:02:02.000Z",
});
const tailDetail = await call(`/api/activities/${tailActivity.id}`);
console.log("STOP_FINAL_FIX_RACE", JSON.stringify({
  finalizeStatus: finalize.status,
  latePointStatus: latePoint.status,
  responsePointCount: tailDetail.body?.pointCount,
  persistedTrackCoordinateCount: tailDetail.body?.activity?.trackGeometry?.coordinates?.length,
  detailPagePrefersPersistedTrack: Boolean(tailDetail.body?.activity?.trackGeometry),
}));
