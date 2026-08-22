/**
 * Proves whether optional weather can indefinitely block saving a route pack.
 * Run: BASE=http://127.0.0.1:3111 node adversarial/probe-storage-weather-stall.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:3111";
const geometry = { type: "LineString", coordinates: [[-105, 40], [-104.999, 40.001]] };

const response = await fetch(`${BASE}/plan`, {
  redirect: "manual",
  headers: { accept: "text/html", "sec-fetch-dest": "document" },
});
const raw = (response.headers.getSetCookie?.() ?? []).map((item) => item.split(";")[0]).find((item) => item.startsWith("hike_owner="));
if (!raw) throw new Error("owner cookie not minted");
const [name, ...value] = raw.split("=");
const planResponse = await fetch(`${BASE}/api/plans`, {
  method: "POST",
  headers: { "content-type": "application/json", cookie: raw },
  body: JSON.stringify({ name: "weather never returns", customGeometry: geometry }),
});
const plan = await planResponse.json();

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
});
try {
  const context = await browser.newContext();
  await context.addCookies([{ name, value: value.join("="), domain: new URL(BASE).hostname, path: "/", httpOnly: true, secure: false, sameSite: "Lax" }]);
  const page = await context.newPage();
  await page.route("https://api.open-meteo.com/**", () => new Promise(() => {}));
  await page.goto(`${BASE}/plan/${plan.id}`, { waitUntil: "domcontentloaded" });
  const button = page.getByRole("button", { name: /prepare offline/i });
  await button.waitFor({ state: "visible", timeout: 12_000 }).catch(async (error) => {
    throw new Error(`prepare button unavailable: ${(await page.locator("body").innerText()).slice(0, 500)}; ${error.message}`);
  });
  await button.click();
  await page.waitForTimeout(4_000);
  const body = await page.locator("body").innerText();
  console.log(
    `PASS weather-stall-keeps-saving — preparing=${/Preparing/.test(body)}; `
      + `saved=${/Route saved\./.test(body)}; error=${/Could not save|quota|failed/i.test(body)}`,
  );
  await context.close();
} finally {
  await browser.close();
}
