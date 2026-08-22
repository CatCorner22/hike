/**
 * Race/lifecycle probes against the already-running local production server.
 *
 * Run:
 *   BASE=http://127.0.0.1:3111 node adversarial/probe-race-lifecycle.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:3111";
const geometry = {
  type: "LineString",
  coordinates: [[-119.5383, 37.7749], [-119.5379, 37.7751], [-119.5375, 37.7754]],
};

let cookie = "";

async function request(path, { method = "GET", body } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      accept: "application/json",
      ...(cookie ? { cookie } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* report non-JSON failures below */ }
  return { status: response.status, json, text };
}

async function establishOwner() {
  const response = await fetch(`${BASE}/plan`, {
    headers: { accept: "text/html", "sec-fetch-dest": "document" },
  });
  const setCookie = response.headers.get("set-cookie");
  cookie = setCookie?.split(";")[0] ?? "";
  if (!cookie.startsWith("hike_owner=")) throw new Error("owner cookie was not issued");
}

async function createPlan(name) {
  const response = await request("/api/plans", {
    method: "POST",
    body: { name, notes: "original notes", customGeometry: geometry },
  });
  if (response.status !== 200 || !response.json?.id) throw new Error(`plan creation failed: ${response.status} ${response.text}`);
  return response.json;
}

async function createActivity(name) {
  const response = await request("/api/activities", {
    method: "POST",
    body: { name, startedAt: "2026-08-20T18:00:00.000Z" },
  });
  if (response.status !== 200 || !response.json?.id) throw new Error(`activity creation failed: ${response.status} ${response.text}`);
  return response.json;
}

async function main() {
  await establishOwner();

  // Reproduce the full-document stale snapshots sent by PlanDetailPage.save().
  const plan = await createPlan("race-plan-original");
  const leftSnapshot = {
    name: "race-plan-renamed-in-tab-A",
    notes: "original notes",
    waypoints: [],
    campgroundIds: [],
    customGeometry: geometry,
  };
  const rightSnapshot = {
    name: "race-plan-original",
    notes: "notes-written-in-tab-B",
    waypoints: [],
    campgroundIds: [],
    customGeometry: geometry,
  };
  const [patchA, patchB] = await Promise.all([
    request(`/api/plans/${plan.id}`, { method: "PATCH", body: leftSnapshot }),
    request(`/api/plans/${plan.id}`, { method: "PATCH", body: rightSnapshot }),
  ]);
  const finalPlan = await request(`/api/plans/${plan.id}`);
  const mergedBothEdits =
    finalPlan.json?.name === leftSnapshot.name &&
    finalPlan.json?.notes === rightSnapshot.notes;
  console.log("PLAN_STALE_SNAPSHOT_RACE", JSON.stringify({
    patchStatuses: [patchA.status, patchB.status],
    final: { name: finalPlan.json?.name, notes: finalPlan.json?.notes },
    mergedBothEdits,
  }));

  // The same durable point sent twice is accepted twice. This is the server
  // behavior a cross-tab flush or an ambiguous failed response relies on.
  const duplicateActivity = await createActivity("race-duplicate-points");
  const exactPoint = {
    lat: 37.775,
    lng: -119.538,
    elevation: 1234,
    recordedAt: "2026-08-20T18:01:01.000Z",
  };
  const [pointA, pointB] = await Promise.all([
    request(`/api/activities/${duplicateActivity.id}/points`, { method: "POST", body: exactPoint }),
    request(`/api/activities/${duplicateActivity.id}/points`, { method: "POST", body: exactPoint }),
  ]);
  const duplicateRead = await request(`/api/activities/${duplicateActivity.id}/points?limit=20`);
  const duplicates = (duplicateRead.json?.points ?? []).filter((point) =>
    point.lat === exactPoint.lat &&
    point.lng === exactPoint.lng &&
    point.recordedAt === exactPoint.recordedAt,
  ).length;
  console.log("POINT_RETRY_DUPLICATION", JSON.stringify({
    postStatuses: [pointA.status, pointB.status],
    matchingPersistedPoints: duplicates,
  }));

  // Model a stop racing an in-flight final GPS POST: PATCH builds and persists
  // trackGeometry from current points, then the final point commits. The detail
  // page prefers the stale activity.trackGeometry over the complete point list.
  const tailActivity = await createActivity("race-stale-track-tail");
  const firstTwo = [
    { lat: 37.7749, lng: -119.5383, recordedAt: "2026-08-20T18:02:00.000Z" },
    { lat: 37.7751, lng: -119.5379, recordedAt: "2026-08-20T18:02:01.000Z" },
  ];
  for (const point of firstTwo) {
    const added = await request(`/api/activities/${tailActivity.id}/points`, { method: "POST", body: point });
    if (added.status !== 200) throw new Error(`seed point failed: ${added.status}`);
  }
  const finish = await request(`/api/activities/${tailActivity.id}`, {
    method: "PATCH",
    body: {
      endedAt: "2026-08-20T18:02:02.000Z",
      stats: { distanceMeters: 50, elevationGainMeters: 0, durationSeconds: 2 },
    },
  });
  const tailPost = await request(`/api/activities/${tailActivity.id}/points`, {
    method: "POST",
    body: { lat: 37.7754, lng: -119.5375, recordedAt: "2026-08-20T18:02:02.000Z" },
  });
  const tailRead = await request(`/api/activities/${tailActivity.id}`);
  console.log("STOP_FINAL_FIX_RACE", JSON.stringify({
    patchStatus: finish.status,
    finalPointStatus: tailPost.status,
    returnedPointCount: tailRead.json?.pointCount,
    returnedTrackCoordinateCount: tailRead.json?.activity?.trackGeometry?.coordinates?.length,
    detailPageWouldPreferPersistedTrack: Boolean(tailRead.json?.activity?.trackGeometry),
  }));

  // Browser lifecycle: an active recording survives server-side but is not
  // restored after a document reload; the newly loaded screen only offers Start.
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  });
  const context = await browser.newContext({
    permissions: ["geolocation"],
    geolocation: { latitude: 37.7749, longitude: -119.5383, accuracy: 5 },
  });
  const [name, value] = cookie.split("=");
  await context.addCookies([{ name, value, domain: new URL(BASE).hostname, path: "/", httpOnly: true, sameSite: "Lax" }]);
  const recoveryPlan = await createPlan("race-reload-recovery");
  const page = await context.newPage();
  await page.goto(`${BASE}/plan/${recoveryPlan.id}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Start recording" }).click();
  await page.getByRole("button", { name: "Pause" }).waitFor({ timeout: 10_000 });
  const activeBeforeReload = await request("/api/activities");
  const activeId = activeBeforeReload.json?.activities?.find((activity) => activity.name === null && activity.planId === recoveryPlan.id)?.id;
  await page.reload({ waitUntil: "networkidle" });
  const startVisible = await page.getByRole("button", { name: "Start recording" }).isVisible();
  const resumeVisible = await page.getByRole("button", { name: "Resume" }).count();
  const activityAfterReload = activeId ? await request(`/api/activities/${activeId}`) : { json: null };
  console.log("RECORDER_RELOAD_LIFECYCLE", JSON.stringify({
    activeActivityCreated: Boolean(activeId),
    startVisibleAfterReload: startVisible,
    resumeControlsAfterReload: resumeVisible,
    endedAtAfterReload: activityAfterReload.json?.activity?.endedAt ?? null,
  }));
  await browser.close();
}

main().catch((error) => {
  console.error("PROBE_ERROR", error.stack || error);
  process.exitCode = 1;
});
