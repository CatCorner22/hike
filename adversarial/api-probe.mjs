#!/usr/bin/env node
/**
 * Post-remediation HTTP probe. It uses two independent cookie jars so that
 * owner A and owner B exercise the same routes as separate devices.
 */
const BASE = process.env.API_BASE || "http://127.0.0.1:3111";
let pass = 0;
let fail = 0;

function result(ok, label, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` :: ${detail}` : ""}`);
  if (ok) pass += 1; else fail += 1;
}

function client() {
  let cookie = "";
  /**
   * Sessions are minted only on document navigations; a cookie-less API call is
   * refused with 401 by design (that is what stops a script minting owners
   * without limit). So each simulated device must first load a page, exactly
   * like a browser, before it can call the API.
   */
  const bootstrap = async () => {
    if (cookie) return;
    const res = await fetch(`${BASE}/plan`, {
      headers: { accept: "text/html", "sec-fetch-dest": "document" },
      redirect: "manual",
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
  };
  return async (path, options = {}) => {
    if (path.startsWith("/api/") && options.anonymous !== true) await bootstrap();
    const headers = new Headers(options.headers);
    if (cookie && options.anonymous !== true) headers.set("cookie", cookie);
    const response = await fetch(`${BASE}${path}`, { ...options, headers });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: response.status, body, headers: Object.fromEntries(response.headers) };
  };
}

const json = (value, method = "POST") => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(value),
});

async function main() {
  const ownerA = client();
  const ownerB = client();
  const plan = await ownerA("/api/plans", json({ name: "owner A plan" }));
  result(plan.status === 200 && plan.body?.id, "owner A can create a plan", `HTTP ${plan.status}`);
  const planId = plan.body.id;

  const planListB = await ownerB("/api/plans");
  result(planListB.status === 200 && !planListB.body.plans.some((item) => item.id === planId), "F-01 plan list is device scoped", `HTTP ${planListB.status}`);
  result((await ownerB(`/api/plans/${planId}`)).status === 404, "F-01 plan read is indistinguishable from missing");
  result((await ownerB(`/api/plans/${planId}`, json({ notes: "cross-device" }, "PATCH"))).status === 404, "F-01 plan patch is denied as 404");
  result((await ownerB(`/api/plans/${planId}`, { method: "DELETE" })).status === 404, "F-01 plan delete is denied as 404");
  result((await ownerA(`/api/plans/${planId}`)).body.notes === null, "cross-device plan mutation was not applied");

  const activity = await ownerA("/api/activities", json({ name: "owner A activity", startedAt: "2026-08-20T10:00:00Z" }));
  result(activity.status === 200 && activity.body?.id, "owner A can create an activity", `HTTP ${activity.status}`);
  const activityId = activity.body.id;
  result((await ownerB("/api/activities")).body.activities.every((item) => item.id !== activityId), "F-01 activity list is device scoped");
  result((await ownerB(`/api/activities/${activityId}`, json({ notes: "cross-device" }, "PATCH"))).status === 404, "F-01 activity patch is denied as 404");
  result((await ownerB(`/api/activities/${activityId}/points?limit=10`)).status === 404, "F-01 point history is denied as 404");

  for (let index = 0; index < 3; index += 1) {
    await ownerA(`/api/activities/${activityId}/points`, json({
      lat: 37.7 + index / 1000, lng: -119.5, recordedAt: `2026-08-20T10:00:0${index}Z`,
    }));
  }
  const page = await ownerA(`/api/activities/${activityId}/points?limit=2`);
  result(page.status === 200 && page.body.points.length === 2 && page.body.pagination?.hasMore === true && typeof page.body.pagination?.nextCursor === "string", "F-06 point endpoint is bounded and cursor paginated", `points=${page.body.points?.length} pagination=${JSON.stringify(page.body.pagination)}`);
  const secondPage = await ownerA(`/api/activities/${activityId}/points?limit=2&cursor=${encodeURIComponent(page.body.pagination.nextCursor)}`);
  result(secondPage.status === 200 && secondPage.body.points.length === 1 && secondPage.body.pagination?.hasMore === false, "F-06 stable point cursor advances", `points=${secondPage.body.points?.length} pagination=${JSON.stringify(secondPage.body.pagination)}`);

  const huge = "x".repeat(1024 * 1024);
  const oversized = await ownerA("/api/plans", json({ name: "oversized", waypoints: [{ lat: 1, lng: 2, notes: huge }] }));
  result(oversized.status === 413, "F-03 request byte cap rejects oversized JSON", `HTTP ${oversized.status}`);
  const malformedGpx = await ownerA("/api/sync/offline", json({ gpx: '<gpx><trkseg><trkpt lat="12evil" lon="34"/><trkpt lat="13" lon="35"/></trkseg></gpx>' }));
  result(malformedGpx.status === 400, "F-08 rejects malformed GPX coordinate prefixes", `HTTP ${malformedGpx.status}`);
  const unsafeStats = await ownerA(`/api/activities/${activityId}`, json({ stats: { distanceMeters: 9007199254740993 } }, "PATCH"));
  result(unsafeStats.status === 400, "F-09 rejects unsafe statistic integers", `HTTP ${unsafeStats.status}`);
  const headers = await ownerA("/api/plans");
  result(Boolean(headers.headers["content-security-policy"]) && headers.headers["x-content-type-options"] === "nosniff" && headers.headers["cache-control"] === "no-store", "F-07 and F-04 security/cache headers are present");
  result(
    /max-age=\d{7,}/.test(headers.headers["strict-transport-security"] ?? ""),
    "F-11 HSTS pins the connection to https",
    headers.headers["strict-transport-security"] ?? "(absent)",
  );

  // The one request that answers "is this deployment able to do its job at all".
  const health = await ownerA("/api/health");
  result(
    health.status === 200
      && health.body?.canStoreUserData === true
      && Array.isArray(health.body?.checks)
      && health.body.checks.every((check) => check.status !== "fail"),
    "F-10 health endpoint reports a working deployment",
    `HTTP ${health.status} ${JSON.stringify(health.body?.checks?.filter((c) => c.status !== "ok") ?? [])}`,
  );
  result(
    !JSON.stringify(health.body).includes("postgresql://")
      && !JSON.stringify(health.body).includes(process.env.SESSION_SECRET ?? "\u0000never"),
    "F-10 health endpoint leaks no credential",
  );

  console.log(`\nSUMMARY PASS=${pass} FAIL=${fail}`);
  process.exitCode = fail ? 2 : 0;
}

main().catch((error) => {
  console.error("FAIL probe fatal", error);
  process.exitCode = 2;
});
