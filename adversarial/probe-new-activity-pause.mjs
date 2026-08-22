import { chromium } from "playwright";

const BASE = "http://127.0.0.1:3111";
const trail = {
  id: "pause-probe",
  osmId: "pause-probe",
  osmType: "way",
  name: "Pause probe trail",
  geometry: { type: "LineString", coordinates: [[-105, 40], [-104.99, 40]] },
  bbox: [-105, 40, -104.99, 40],
  center: { lat: 40, lng: -105 },
  elevationProfile: [],
};

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
});
const context = await browser.newContext();
await context.addInitScript(() => {
  const callbacks = new Map();
  let nextId = 0;
  navigator.geolocation.watchPosition = (success) => {
    const id = ++nextId;
    callbacks.set(id, success);
    return id;
  };
  navigator.geolocation.clearWatch = (id) => callbacks.delete(id);
  window.__probeEmitPosition = (lat, lng) => {
    for (const success of callbacks.values()) {
      success({
        coords: { latitude: lat, longitude: lng, altitude: 0, accuracy: 5 },
        timestamp: Date.now(),
      });
    }
  };
});

const page = await context.newPage();
const patches = [];
await page.route("**/api/trails/pause-probe", (route) =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(trail) }),
);
await page.route("**/api/research/pause-probe*", (route) =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ brief: null }) }),
);
await page.route("**/api/activities**", async (route) => {
  const request = route.request();
  if (request.method() === "POST" && request.url().endsWith("/api/activities")) {
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "act-1" }) });
  }
  if (request.method() === "PATCH") {
    patches.push({ url: request.url(), body: request.postDataJSON() });
  }
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
});

try {
  await page.goto(`${BASE}/trails/pause-probe`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Start recording" }).waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: "Start recording" }).click();
  await page.getByRole("button", { name: "Pause" }).waitFor();
  await page.evaluate(() => window.__probeEmitPosition(40, -105));
  await page.waitForTimeout(50);
  await page.getByRole("button", { name: "Pause" }).click();
  await page.getByRole("button", { name: "Resume" }).waitFor();
  await page.waitForTimeout(200);
  // The hiker moved 1.1 km while paused. The location only arrives after Resume.
  await page.getByRole("button", { name: "Resume" }).click();
  await page.getByRole("button", { name: "Pause" }).waitFor();
  await page.waitForTimeout(200);
  await page.evaluate(() => window.__probeEmitPosition(40, -104.99));
  await page.waitForTimeout(50);
  await page.getByRole("button", { name: /Stop & save/ }).click();
  await page.waitForTimeout(100);
  const finish = patches.find((patch) => patch.body?.endedAt);
  console.log("PAUSE_DISTANCE_RESULT", JSON.stringify({
    patchCount: patches.length,
    distanceMeters: finish?.body?.stats?.distanceMeters,
    durationSeconds: finish?.body?.stats?.durationSeconds,
  }));
  if ((finish?.body?.stats?.distanceMeters ?? 0) > 100) {
    throw new Error(`Paused movement must not count as hiking distance; received ${JSON.stringify(finish)}`);
  }
} finally {
  await browser.close();
}
