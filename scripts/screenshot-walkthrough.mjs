/* Phase D grounding: iPhone-sized screenshots of the real app for the panel. */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3111";
const OUT = process.env.SHOT_DIR ?? "./shots";
/**
 * App Store Connect requires exact pixel sizes. The 6.7" iPhone slot
 * (1290x2796) is the one every modern listing needs; 430x932 at
 * deviceScaleFactor 3 produces it exactly. Set SHOT_SIZE=review for the
 * smaller review/grounding shots instead.
 */
const STORE_SIZE = process.env.SHOT_SIZE !== "review";
const VIEWPORT = STORE_SIZE
  ? { width: 430, height: 932 }
  : { width: 390, height: 844 };
const SCALE = STORE_SIZE ? 3 : 2;
const GEO = { latitude: 37.7345, longitude: -119.6032 };
mkdirSync(OUT, { recursive: true });

const DEMO_ROUTE = {
  name: "Panel walkthrough route",
  geometry: {
    type: "LineString",
    coordinates: Array.from({ length: 24 }, (_, i) => [
      -119.6032 + i * 0.0016,
      37.7345 + i * 0.0011,
    ]),
  },
};

async function createPlan() {
  const context = await fetch(`${BASE}/plan`, { headers: { "sec-fetch-dest": "document" } });
  const cookie = context.headers.get("set-cookie")?.split(";")[0];
  const res = await fetch(`${BASE}/api/plans`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ name: DEMO_ROUTE.name, customGeometry: DEMO_ROUTE.geometry }),
  });
  if (!res.ok) throw new Error(`plan create failed: ${res.status} ${await res.text()}`);
  const { id } = await res.json();
  return { id, cookie };
}

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);

const { id: planId, cookie } = await createPlan();
const context = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: SCALE,
  isMobile: true,
  hasTouch: true,
  permissions: ["geolocation"],
  geolocation: GEO,
  serviceWorkers: "allow",
});
await context.addCookies([
  {
    name: cookie.split("=")[0],
    value: cookie.split("=").slice(1).join("="),
    url: BASE,
  },
]);
const page = await context.newPage();

async function shot(name, path, { settle = 1800, dark = false } = {}) {
  await page.emulateMedia({ colorScheme: dark ? "dark" : "light" });
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(settle);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`shot ${name}`);
}

await shot("01-home", "/");
await shot("02-explore", "/explore");
await shot("03-plan-list", "/plan");
await shot("04-plan-detail", `/plan/detail?id=${planId}`, { settle: 3500 });

// Prepare offline from the plan screen so navigate has a pack + shell.
const prepare = page.getByRole("button", { name: /prepare offline|update offline/i });
try {
  await prepare.first().click({ timeout: 8000 });
  await page.waitForTimeout(9000);
  await page.screenshot({ path: `${OUT}/05-prepare-offline.png` });
  console.log("shot 05-prepare-offline");
} catch (error) {
  console.log("prepare click skipped:", String(error).split("\n")[0]);
}

await shot("06-go-launcher", "/go", { settle: 2500 });
await shot("07-readiness-gate", `/navigate?target=plan-${planId}`, { settle: 6000 });

// Past the gate to the live HUD.
try {
  await page.getByRole("button", { name: /skip saving and show the map/i }).click({ timeout: 6000 });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${OUT}/07b-navigate-hud.png` });
  console.log("shot 07b-navigate-hud");
} catch (error) {
  console.log("gate skip failed:", String(error).split("\n")[0]);
}

// Safety panel sheet (the trigger carries the SOS / Safety wording).
try {
  await page.getByRole("button", { name: /sos|safety|emergency/i }).first().click({ timeout: 6000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/08-safety-panel.png` });
  console.log("shot 08-safety-panel");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
} catch (error) {
  console.log("panel open skipped:", String(error).split("\n")[0]);
}

// Night modes via the HUD toggle if present.
try {
  const moon = page.getByRole("button", { name: /night|red|nvg|moon/i }).first();
  await moon.click({ timeout: 5000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/09-navigate-red.png` });
  console.log("shot 09-navigate-red");
} catch (error) {
  console.log("night toggle skipped:", String(error).split("\n")[0]);
}

await shot("10-guide", "/guide", { settle: 2000 });
await shot("11-home-dark", "/", { dark: true });
await shot("12-saved", "/saved", { settle: 2500 });

await browser.close();
console.log("walkthrough complete");
