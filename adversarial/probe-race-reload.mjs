/**
 * Recorder lifecycle/reload probe. Run:
 * BASE=http://127.0.0.1:3111 node adversarial/probe-race-reload.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:3111";
const geometry = { type: "LineString", coordinates: [[-119.5383, 37.7749], [-119.5379, 37.7751]] };
const doc = await fetch(`${BASE}/plan`, { headers: { accept: "text/html", "sec-fetch-dest": "document" } });
const cookie = doc.headers.get("set-cookie")?.split(";")[0];
if (!cookie) throw new Error("owner cookie was not issued");

async function api(path, method = "GET", body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}

const plan = await api("/api/plans", "POST", { name: "reload lifecycle probe", customGeometry: geometry });
if (plan.status !== 200) throw new Error(`plan creation failed: ${plan.status}`);
const [name, value] = cookie.split("=");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
});
try {
  const context = await browser.newContext({ permissions: ["geolocation"], geolocation: { latitude: 37.7749, longitude: -119.5383, accuracy: 5 } });
  await context.addCookies([{ name, value, domain: new URL(BASE).hostname, path: "/", httpOnly: true, sameSite: "Lax" }]);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${BASE}/plan/detail?id=${plan.body.id}`, { waitUntil: "domcontentloaded", timeout: 20_000 });
  const start = page.getByRole("button", { name: "Start recording" });
  await start.waitFor({ state: "visible", timeout: 20_000 });
  await start.click();
  await page.getByRole("button", { name: "Pause" }).waitFor({ state: "visible", timeout: 20_000 });
  const active = await api("/api/activities");
  const recording = active.body.activities.find((activity) => activity.planId === plan.body.id && activity.endedAt === null);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
  await page.getByRole("button", { name: "Start recording" }).waitFor({ state: "visible", timeout: 20_000 });
  const resumed = await page.getByRole("button", { name: "Resume" }).count();
  const after = recording ? await api(`/api/activities/${recording.id}`) : null;
  console.log("RECORDER_RELOAD_LIFECYCLE", JSON.stringify({
    activityCreated: Boolean(recording),
    startButtonAfterReload: true,
    resumeButtonsAfterReload: resumed,
    persistedActivityEndedAt: after?.body?.activity?.endedAt ?? null,
    browserErrors: errors,
  }));
  await context.close();
} finally {
  await browser.close();
}
