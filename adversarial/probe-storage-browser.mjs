/**
 * Storage adversarial probe.
 * Run: BASE=http://127.0.0.1:3111 node adversarial/probe-storage-browser.mjs
 *
 * Exercises the production server in isolated Chromium profiles. It deliberately
 * mutates IndexedDB only in those throw-away profiles.
 */
import { chromium } from "playwright";
import {
  NAV_PACK_STORES,
  OPEN_ENSURING_STORES,
  packFixture,
} from "./idb-open.mjs";

const BASE = process.env.BASE ?? "http://127.0.0.1:3111";
const ORIGIN = new URL(BASE).origin;
const GEOMETRY = {
  type: "LineString",
  coordinates: [[-105, 40], [-104.999, 40.0005], [-104.998, 40.001]],
};
const results = [];

function result(name, ok, detail) {
  const row = { name, ok, detail };
  results.push(row);
  console.log(`${ok ? "PASS" : "FAIL"} ${name} — ${detail}`);
  return row;
}

async function ownerCookie() {
  const response = await fetch(`${BASE}/plan`, {
    redirect: "manual",
    headers: { accept: "text/html", "sec-fetch-dest": "document" },
  });
  const cookies = response.headers.getSetCookie?.() ?? [];
  const raw = cookies.map((item) => item.split(";")[0]).find((item) => item.startsWith("hike_owner="));
  if (!raw) throw new Error("document navigation did not mint hike_owner cookie");
  const [name, ...value] = raw.split("=");
  return { name, value: value.join("="), domain: new URL(BASE).hostname, path: "/", httpOnly: true, sameSite: "Lax" };
}

let cookie;
async function newContext(browser, options = {}) {
  const context = await browser.newContext(options);
  await context.addCookies([cookie]);
  return context;
}

async function createPlan(label) {
  const response = await fetch(`${BASE}/api/plans`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `${cookie.name}=${cookie.value}` },
    body: JSON.stringify({ name: label, customGeometry: GEOMETRY }),
  });
  if (!response.ok) throw new Error(`plan creation failed (${response.status}): ${await response.text()}`);
  return (await response.json()).id;
}

async function bodyText(page) {
  return (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
}

async function waitForSaveResult(page) {
  await page.locator('[data-offline-result="complete"]').waitFor({ state: "visible", timeout: 25_000 });
  return bodyText(page);
}

async function preparePlan(page, id) {
  await page.goto(`${BASE}/plan/detail?id=${id}`, { waitUntil: "domcontentloaded" });
  const button = page.getByRole("button", { name: /prepare offline|update offline (?:pack|route)/i });
  await button.waitFor({ state: "visible", timeout: 12_000 });
  await button.click();
  return waitForSaveResult(page);
}

async function disableWeather(page) {
  await page.route(
    "https://api.open-meteo.com/**",
    (route) => route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
  );
}

async function disableShellWarmup(page) {
  await page.route(
    `${BASE}/navigate**`,
    (route) => route.fulfill({ status: 503, contentType: "text/plain", body: "probe: shell unavailable" }),
  );
}

async function seedPack(page, navId, mutate = (pack) => pack, extras = []) {
  const pack = mutate(packFixture(navId, GEOMETRY.coordinates));
  await page.evaluate(async ({ source, stores, pack, extras }) => {
    (0, eval)(source);
    const db = await openEnsuringStores("hike-nav-packs", stores);
    const tx = db.transaction(["routePacks", "aliases"], "readwrite");
    tx.objectStore("routePacks").put(pack);
    for (const alias of pack.aliases ?? []) tx.objectStore("aliases").put({ alias, canonicalId: pack.id });
    for (const row of extras) {
      if (row.store === "routePacks") tx.objectStore("routePacks").put(row.value);
      if (row.store === "aliases") tx.objectStore("aliases").put(row.value);
    }
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  }, { source: OPEN_ENSURING_STORES, stores: NAV_PACK_STORES, pack, extras });
}

async function databaseAtVersion(page, version, stores = []) {
  await page.evaluate(async ({ version, stores }) => {
    await new Promise((resolve, reject) => {
      const wipe = indexedDB.deleteDatabase("hike-nav-packs");
      wipe.onerror = () => reject(wipe.error);
      wipe.onblocked = () => reject(new Error("database delete blocked"));
      wipe.onsuccess = () => {
        const request = indexedDB.open("hike-nav-packs", version);
        request.onerror = () => reject(request.error);
        request.onupgradeneeded = () => {
          for (const store of stores) request.result.createObjectStore(store.name, { keyPath: store.keyPath });
        };
        request.onsuccess = () => { request.result.close(); resolve(); };
      };
    });
  }, { version, stores });
}

async function scenarioPersistenceRefused(browser) {
  const context = await newContext(browser);
  await context.addInitScript(() => {
    Object.defineProperty(navigator.storage, "persist", { configurable: true, value: async () => false });
    Object.defineProperty(navigator.storage, "persisted", { configurable: true, value: async () => false });
  });
  const page = await context.newPage();
  await disableWeather(page);
  await disableShellWarmup(page);
  const id = await createPlan("storage refusal");
  const text = await preparePlan(page, id);
  const persistenceRow = page.locator('[data-offline-check="storage-persistence"]');
  const persistenceText = (await persistenceRow.innerText()).replace(/\s+/g, " ").trim();
  const persistenceStatus = await persistenceRow.getAttribute("data-offline-status");
  const warning = /The browser may remove this saved route when device storage is low\./.test(text);
  const readiness = persistenceStatus === "warning"
    && /Saved routes less likely to be removed/.test(persistenceText)
    && /The browser may remove saved data when device storage is low\./.test(persistenceText);
  result("persist-refused-visible", warning && readiness, `message=${warning}; readiness-row=${readiness}`);
  await context.close();
}

async function scenarioQuota(browser) {
  const context = await newContext(browser);
  const page = await context.newPage();
  await disableWeather(page);
  await disableShellWarmup(page);
  const session = await context.newCDPSession(page);
  // Establish origin first without starting the app's IndexedDB code.
  await page.goto(`${BASE}/manifest.webmanifest`, { waitUntil: "domcontentloaded" });
  await session.send("Storage.overrideQuotaForOrigin", { origin: ORIGIN, quotaSize: 1 });
  const id = await createPlan("quota one byte");
  await page.goto(`${BASE}/plan/detail?id=${id}`, { waitUntil: "domcontentloaded" });
  const action = page.getByRole("button", { name: /prepare offline|update offline (?:pack|route)/i });
  await action.click();
  let completed = true;
  try {
    await page.locator('[data-offline-result="complete"]').waitFor({ state: "visible", timeout: 10_000 });
  } catch {
    completed = false;
  }
  const resultText = completed
    ? (await page.locator('[data-offline-result="complete"]').innerText()).replace(/\s+/g, " ").trim()
    : "";
  const stored = await page.evaluate(async ({ packId, alias }) => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("hike-nav-packs");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(["routePacks", "aliases"], "readonly");
        const packRequest = tx.objectStore("routePacks").get(packId);
        const aliasRequest = tx.objectStore("aliases").get(alias);
        tx.oncomplete = () => {
          db.close();
          resolve({ pack: packRequest.result != null, alias: aliasRequest.result != null });
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, { packId: `plan-${id}`, alias: id });
  const routeStatus = await page.locator('[data-offline-check="route-pack"]').getAttribute("data-offline-status");
  const failed = /Offline storage is full\. Reconnect, sync or remove recordings, then re-download this route before relying on this device\./.test(resultText)
    && routeStatus === "warning"
    && !stored.pack
    && !stored.alias;
  const button = await action.innerText();
  result("quota-exhaustion-no-false-ready", completed && failed && /Prepare offline/i.test(button), `completed=${completed}; failed=${failed}; stored=${JSON.stringify(stored)}; button=${JSON.stringify(button)}; result=${JSON.stringify(resultText)}`);
  // CDP uses -1 to remove an override; zero is itself a zero-byte quota.
  await session.send("Storage.overrideQuotaForOrigin", { origin: ORIGIN, quotaSize: -1 }).catch(() => {});
  await context.close();
}

async function scenarioLiveEvictionClaim(browser) {
  const context = await newContext(browser);
  const page = await context.newPage();
  const id = await createPlan("live eviction");
  await page.goto(`${BASE}/manifest.webmanifest`, { waitUntil: "domcontentloaded" });
  await seedPack(page, `plan-${id}`);
  await page.goto(`${BASE}/plan/detail?id=${id}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    const row = document.querySelector('[data-offline-check="route-pack"]');
    return row?.getAttribute("data-offline-status") === "ready"
      && /The marked route and its safety information are saved on this device\./.test(row.textContent ?? "");
  }, null, { timeout: 12_000 });
  const routeRow = page.locator('[data-offline-check="route-pack"]');
  const before = (await routeRow.innerText()).replace(/\s+/g, " ").trim();
  const wasSaved = await routeRow.getAttribute("data-offline-status") === "ready"
    && /Route saved.*The marked route and its safety information are saved on this device\./.test(before);
  // Simulate an eviction/corrupted-IDB event by emptying the two persistent
  // stores while React is still showing the post-save readiness state.
  await page.evaluate(async () => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.open("hike-nav-packs");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(["routePacks", "aliases"], "readwrite");
        tx.objectStore("routePacks").clear();
        tx.objectStore("aliases").clear();
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  // Browsers do not notify an open document when they evict IndexedDB. Re-entry
  // is the app's next reliable chance to revalidate the pack before the hiker
  // relies on the page's affirmative claim.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForFunction(
    () => {
      const row = document.querySelector('[data-offline-check="route-pack"]');
      return row?.getAttribute("data-offline-status") === "warning"
        && /Route missing — prepare it again while online/.test(row.textContent ?? "");
    },
    null,
    { timeout: 12_000 },
  );
  await page.getByRole("button", { name: /prepare offline/i }).waitFor({ state: "visible", timeout: 12_000 });
  const text = (await routeRow.innerText()).replace(/\s+/g, " ").trim();
  const status = await routeRow.getAttribute("data-offline-status");
  const button = await page.getByRole("button", { name: /prepare offline|update offline (?:pack|route)/i }).innerText();
  const stillClaimsSaved = status === "ready"
    || /Route saved.*The marked route and its safety information are saved on this device\./.test(text);
  const safeAfterEviction = status === "warning"
    && /Route missing — prepare it again while online/.test(text)
    && !stillClaimsSaved
    && /Prepare offline/i.test(button);
  result("eviction-live-ui-claim", wasSaved && safeAfterEviction, `initial=${wasSaved}; safe-after-eviction=${safeAfterEviction}; button=${JSON.stringify(button)}`);
  await context.close();
}

async function scenarioAliasWriteQuota(browser) {
  const context = await newContext(browser);
  await context.addInitScript(() => {
    const nativePut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function storageProbePut(value, key) {
      if (this.name === "aliases") throw new DOMException("synthetic storage full", "QuotaExceededError");
      return arguments.length === 1 ? nativePut.call(this, value) : nativePut.call(this, value, key);
    };
  });
  const page = await context.newPage();
  await disableWeather(page);
  await disableShellWarmup(page);
  const id = await createPlan("quota alias failure");
  const text = await preparePlan(page, id);
  const rows = await page.evaluate(async () => {
    const req = indexedDB.open("hike-nav-packs");
    return await new Promise((resolve, reject) => {
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("routePacks", "readonly");
        const getAll = tx.objectStore("routePacks").getAll();
        getAll.onsuccess = () => { db.close(); resolve(getAll.result.length); };
        getAll.onerror = () => reject(getAll.error);
      };
    });
  });
  const actionable = /Offline storage is full.*re-download this route before relying on this device\./is.test(text);
  result("alias-write-quota-visible-and-atomic", actionable && rows === 0, `actionable=${actionable}; rows=${rows}; excerpt=${JSON.stringify(text.slice(-260))}`);
  await context.close();
}

async function scenarioCorruption(browser) {
  const cases = [
    ["truncated-geometry", (pack) => ({ ...pack, geometry: { type: "LineString", coordinates: [pack.geometry.coordinates[0]] } }), /Route geometry is invalid\./],
    ["nonmonotonic-distance", (pack) => ({ ...pack, cumulativeDistancesMeters: [0, 999, 1] }), /Saved route distance index is invalid\./],
    ["epoch-cached-at", (pack) => ({ ...pack, cachedAt: "1970-01-01T00:00:00.000Z" }), /Saved route timestamp is invalid or the device clock is incorrect\./],
  ];
  for (const [name, mutate, expected] of cases) {
    const context = await newContext(browser);
    await context.addInitScript(() => Object.defineProperty(Navigator.prototype, "onLine", { configurable: true, get: () => false }));
    const page = await context.newPage();
    await disableWeather(page);
    const id = await createPlan(`corrupt ${name}`);
    await page.goto(`${BASE}/manifest.webmanifest`, { waitUntil: "domcontentloaded" });
    await seedPack(page, `plan-${id}`, mutate);
    await page.goto(`${BASE}/navigate?target=plan-${id}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => /Cannot navigate offline/.test(document.body.innerText), null, { timeout: 15_000 });
    const text = await bodyText(page);
    result(`corrupt-${name}-refused`, expected.test(text) && /Cannot navigate offline/.test(text), JSON.stringify(text.slice(-250)));
    await context.close();
  }

  const context = await newContext(browser);
  await context.addInitScript(() => Object.defineProperty(Navigator.prototype, "onLine", { configurable: true, get: () => false }));
  const page = await context.newPage();
  await disableWeather(page);
  const id = await createPlan("orphan alias");
  await page.goto(`${BASE}/manifest.webmanifest`, { waitUntil: "domcontentloaded" });
  const orphan = packFixture("orphan-target", GEOMETRY.coordinates);
  await seedPack(page, `plan-${id}`, (pack) => pack, [{ store: "aliases", value: { alias: `plan-${id}`, canonicalId: orphan.id } }]);
  // Remove the actual requested payload; only an alias to a nonexistent pack remains.
  await page.evaluate(async (navId) => {
    const request = indexedDB.open("hike-nav-packs");
    await new Promise((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("routePacks", "readwrite");
        tx.objectStore("routePacks").delete(navId);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, `plan-${id}`);
  await page.goto(`${BASE}/navigate?target=plan-${id}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => /Cannot navigate offline/.test(document.body.innerText), null, { timeout: 15_000 });
  const text = await bodyText(page);
  result("orphan-alias-refused", /No offline route pack and no network\./.test(text), JSON.stringify(text.slice(-250)));
  await context.close();
}

async function scenarioSchema(browser) {
  for (const [name, version, stores, expected] of [
    // Asserts the PROPERTY, not one sentence: the hiker must get plain recovery
    // guidance naming the action. Raw IndexedDB text ("The requested version (4)
    // is less than the existing version (99)") is fine as secondary detail but
    // must not be the primary message -- it tells someone about to lose signal
    // nothing they can act on.
    ["higher-version", 99, [], /incompatible, or damaged saved-route database.*re-download/is],
    ["missing-stores", 4, [{ name: "routePacks", keyPath: "id" }], /incompatible, or damaged saved-route database.*re-download/is],
  ]) {
    const context = await newContext(browser);
    await context.addInitScript(() => Object.defineProperty(Navigator.prototype, "onLine", { configurable: true, get: () => false }));
    const page = await context.newPage();
    await page.goto(`${BASE}/manifest.webmanifest`, { waitUntil: "domcontentloaded" });
    await databaseAtVersion(page, version, stores);
    const id = await createPlan(`schema ${name}`);
    await page.goto(`${BASE}/navigate?target=plan-${id}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => /Cannot navigate offline/.test(document.body.innerText), null, { timeout: 15_000 });
    const text = await bodyText(page);
    const shown = expected.test(text);
    result(`schema-${name}-visible-error`, shown && !/Route saved(?:\s|\.|$)/.test(text), JSON.stringify(text.slice(-280)));
    await context.close();
  }
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  });
  try {
    cookie = await ownerCookie();
    await scenarioPersistenceRefused(browser);
    await scenarioAliasWriteQuota(browser);
    if (process.env.RUN_CDP_QUOTA === "1") await scenarioQuota(browser);
    await scenarioLiveEvictionClaim(browser);
    await scenarioCorruption(browser);
    await scenarioSchema(browser);
  } finally {
    await browser.close();
  }
  console.log(`SUMMARY ${results.filter((item) => item.ok).length}/${results.length} passed`);
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error("FATAL", error?.stack ?? error);
  process.exitCode = 1;
});
