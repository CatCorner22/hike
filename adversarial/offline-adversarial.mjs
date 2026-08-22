/**
 * Adversarial offline/PWA regression probe. Run against `npm run build && npm start`.
 * BASE=http://127.0.0.1:3111 node adversarial/offline-adversarial.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:3111";
const GEO = { latitude: 36.1627, longitude: -86.7816, accuracy: 8 };
const GOOD_GEOMETRY = { type: "LineString", coordinates: Array.from({ length: 40 }, (_, i) => [-86.7816 + i * 0.0003, 36.1627 + i * 0.00015]) };
const results = [];
const log = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };

/**
 * Plans are scoped to an anonymous device-owner cookie, so a plan created with
 * Node's fetch belongs to a different owner than any browser context and will
 * correctly 404 there. `ownerCookie` carries the browser's token so fixtures
 * land in the same owner as the page that will open them.
 */
let ownerCookie = "";
async function createPlan(name = "Adversarial route") {
  const res = await fetch(`${BASE}/api/plans`, { method: "POST", headers: { "content-type": "application/json", ...(ownerCookie ? { cookie: ownerCookie } : {}) }, body: JSON.stringify({ name, customGeometry: GOOD_GEOMETRY }) });
  if (!res.ok) throw new Error(`create plan ${res.status}: ${await res.text()}`);
  return (await res.json()).id;
}
async function waitForController(page) { await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 30_000 }); }
async function screen(page) {
  const text = await page.locator("body").innerText().catch(() => "");
  const html = await page.locator("body").innerHTML().catch(() => "");
  return { text, blank: text.trim().length === 0 || html.trim().length === 0, browserError: /ERR_INTERNET_DISCONNECTED|This site can.t be reached|ERR_FAILED/i.test(text), appError: /Cannot navigate offline|Route geometry is invalid|Plan has no route geometry|Route unavailable offline|Saved route|route pack is corrupt|route has more than/i.test(text), ready: /Offline pack|Saved to device|GPS|North up|Heading up|Pre-hike checklist/i.test(text) };
}

/**
 * Navigate stays locked until ICE + return time exist. Fill the checklist
 * the way a hiker would so probes can reach the HUD.
 */
async function completeReadinessIfShown(page) {
  const checklist = page.locator("text=Pre-hike checklist");
  if ((await checklist.count()) === 0) return;
  await page.locator("#hiker").fill("Pat");
  await page.locator("#ice-name").fill("Sam");
  await page.locator("#ice-phone").fill("555-123-4567");
  const existing = await page.locator("#return").inputValue().catch(() => "");
  if (!existing) {
    const local = new Date(Date.now() + 4 * 3600_000);
    const value = new Date(local.getTime() - local.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
    await page.locator("#return").fill(value);
  }
  const start = page.getByRole("button", { name: /Start navigation/i });
  await start.waitFor({ state: "visible", timeout: 10_000 });
  if (await start.isDisabled()) {
    await page.waitForTimeout(1500);
  }
  if (await start.isEnabled()) {
    await start.click();
    await page.waitForFunction(
      () => !document.body.innerText.includes("Pre-hike checklist"),
      null,
      { timeout: 15_000 },
    );
  }
}
/**
 * One owner for the whole probe run.
 *
 * Plans are scoped to a signed device-owner cookie. Each Playwright context has
 * its own cookie jar, so without this every scenario would create a plan owned
 * by a different device and then correctly fail to load it. Mint one token up
 * front and inject it into Node fetches and every browser context alike.
 */
let ownerCookieObj = null;
async function establishOwner() {
  // Sessions are minted only on DOCUMENT navigations (a cookie-less API call
  // is refused with 401 by design), so ask for HTML the way a browser does.
  const res = await fetch(`${BASE}/plan`, {
    redirect: "manual",
    headers: { accept: "text/html", "sec-fetch-dest": "document" },
  });
  const raw = res.headers.getSetCookie?.() ?? [];
  const found = raw.map(c => c.split(";")[0]).find(c => c.startsWith("hike_owner="));
  if (!found) throw new Error("server did not issue an owner cookie");
  ownerCookie = found;
  const [name, ...rest] = found.split("=");
  const url = new URL(BASE);
  ownerCookieObj = { name, value: rest.join("="), domain: url.hostname, path: "/", httpOnly: true, secure: new URL(BASE).protocol === "https:", sameSite: "Lax" };
}

/** browser.newContext + the shared owner cookie. */
async function newOwnedContext(opts = {}) {
  const context = await browser.newContext(opts);
  if (ownerCookieObj) await context.addCookies([ownerCookieObj]);
  return context;
}

async function openSeeded(planId, opts = {}) {
  const context = await newOwnedContext({ permissions: ["geolocation"], geolocation: GEO, serviceWorkers: "allow" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(`console:${m.text()}`); });
  const url = `${BASE}/navigate/plan-${planId}`;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await waitForController(page);
  await page.waitForTimeout(1200);
  if (opts.prepare) {
    await page.goto(`${BASE}/plan/${planId}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /prepare offline|update offline (?:pack|route)/i }).click({ timeout: 10_000 });
    await page.waitForTimeout(1500);
  }
  return { context, page, errors, url };
}
async function replacePack(page, navId, mutator) {
  return await page.evaluate(async ({ navId, mutatorSource }) => {
    const mutate = (0, eval)(`(${mutatorSource})`);
    await new Promise((resolve, reject) => {
      const req = indexedDB.open("hike-nav-packs");
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(["routePacks", "aliases"], "readwrite");
        const packs = tx.objectStore("routePacks");
        const aliases = tx.objectStore("aliases");
        const get = packs.get(navId);
        get.onerror = () => reject(get.error);
        get.onsuccess = () => {
          const p = get.result;
          if (!p) return reject(new Error(`missing seed pack ${navId}`));
          const next = mutate(p);
          packs.put(next);
          aliases.put({ alias: navId, canonicalId: next.id });
        };
        tx.oncomplete = () => resolve(undefined);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      };
    });
  }, { navId, mutatorSource: mutator.toString() });
}
async function offlineReload(env) {
  await env.context.setOffline(true);
  await env.page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => {});
  await env.page.waitForTimeout(1000);
  return screen(env.page);
}

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
});
await establishOwner();
try {
  // Corrupt route payloads: app must show an explicit failure, never a browser/page blank state.
  const corruptCases = [
    ["geometry-null", p => ({ ...p, geometry: null })],
    ["geometry-object", p => ({ ...p, geometry: {} })],
    ["coordinates-string", p => ({ ...p, geometry: { type: "LineString", coordinates: "not an array" } })],
    ["coordinates-nan", p => ({ ...p, geometry: { type: "LineString", coordinates: [[-86, 36], [Number.NaN, 36]] } })],
    ["single-coordinate", p => ({ ...p, geometry: { type: "LineString", coordinates: [[-86, 36]] } })],
    ["three-dimensional", p => ({ ...p, geometry: { type: "LineString", coordinates: [[-86, 36, 1], [-85.999, 36.001, 2]] } })],
    // Both positions remain legal GeoJSON ranges after swapping, which makes this especially dangerous.
    ["lat-lng-swapped", p => ({ ...p, geometry: { type: "LineString", coordinates: [[36.1627, -86.7816], [36.163, -86.781]] } })],
    ["stale-v1", p => ({ ...p, version: 1 })],
    ["future-v999", p => ({ ...p, version: 999 })],
    ["bad-elevation", p => ({ ...p, elevationProfile: [{ distanceMeters: 100, elevation: 10 }, { distanceMeters: 100, elevation: 20 }, { distanceMeters: -2, elevation: 999 }] })],
    ["50mb-gpx", p => ({ ...p, gpx: "x".repeat(50 * 1024 * 1024) })],
  ];
  for (const [name, mutate] of corruptCases) {
    const planId = await createPlan(`corrupt ${name}`); const env = await openSeeded(planId);
    try {
      await replacePack(env.page, `plan-${planId}`, mutate);
      const s = await offlineReload(env);
      // Network subresource errors are expected after toggling offline; the safety bar is
      // whether the browser/app has a nonblank, non-browser-error screen.
      const noWhiteScreen = !s.blank && !s.browserError;
      log(`corrupt/${name}/no-white-screen`, noWhiteScreen, `${s.appError ? "explicit-app-error" : s.ready ? "rendered-ready" : "other-ui"}; ${s.text.slice(0, 110).replace(/\s+/g, " ")}`);
      if (name === "three-dimensional" || name === "lat-lng-swapped" || name === "bad-elevation" || name === "50mb-gpx") log(`corrupt/${name}/rejected`, s.appError, s.appError ? "explicit error" : "pack accepted/rendered");
    } catch (e) { log(`corrupt/${name}/harness`, false, String(e)); }
    await env.context.close();
  }

  // Optional extras are not the Safety Map. Poison weather, corridor, OSM,
  // forecast, and a fake bailout together, then go offline. The route must
  // still render — a bit-flipped forecast must not blank the trail.
  {
    const planId = await createPlan("stacked extras poison");
    const env = await openSeeded(planId);
    try {
      await replacePack(env.page, `plan-${planId}`, (p) => ({
        ...p,
        weather: { source: "open-meteo", cachedAt: "not-a-date", tempC: Number.NaN },
        corridor: p.corridor
          ? { ...p.corridor, routeId: "foreign-trail" }
          : { routeId: "foreign-trail", bufferMeters: 1, layers: ["hillshade"], bboxes: [[0, 0, 1, 1]], generatedAt: new Date().toISOString() },
        corridorFeatures: {
          routeId: "foreign-trail",
          fetchedAt: new Date().toISOString(),
          source: "openstreetmap-overpass",
          bboxes: [[0, 0, 1, 1]],
          layersIncluded: ["water"],
          featureCount: 0,
          disclaimer: "safe to drink",
          features: { type: "FeatureCollection", features: [] },
        },
        hazardBrief: {
          routeId: "foreign-trail",
          source: "open-meteo",
          disclaimer: "Current weather. You are safe.",
          generatedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3600e3).toISOString(),
          samples: [],
          observations: [],
        },
        bailoutRoutes: [{
          id: "invented",
          routeId: "nope",
          name: "Invented",
          disclaimer: "shortcut",
          geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] },
          join: { lat: 0, lng: 0, alongMeters: 0, offsetMeters: 0 },
          lengthMeters: 100,
        }],
      }));
      const s = await offlineReload(env);
      log(
        "stacked/poisoned-extras-offline-navigates",
        s.ready && !s.appError && !s.blank && !s.browserError,
        s.text.slice(0, 140).replace(/\s+/g, " "),
      );
    } catch (e) {
      log("stacked/poisoned-extras-offline-navigates", false, String(e));
    }
    await env.context.close();
  }

  // Alias conflict: lookup resolves whichever pointer was last written, even if payload's aliases disagree.
  {
    const planId = await createPlan("alias conflict"); const env = await openSeeded(planId);
    const r = await env.page.evaluate(async ({ navId }) => new Promise((resolve, reject) => {
      const req = indexedDB.open("hike-nav-packs"); req.onerror = () => reject(req.error); req.onsuccess = () => {
        const db = req.result; const tx = db.transaction(["routePacks", "aliases"], "readwrite"); const ps = tx.objectStore("routePacks"), as = tx.objectStore("aliases");
        const g = ps.get(navId); g.onsuccess = () => { const p = g.result; ps.put({ ...p, id: "evil-canonical", aliases: ["unrelated"] }); as.put({ alias: navId, canonicalId: "evil-canonical" }); as.put({ alias: "shared", canonicalId: navId }); as.put({ alias: "shared", canonicalId: "evil-canonical" }); };
        tx.oncomplete = () => resolve(true); tx.onerror = () => reject(tx.error);
      };
    }), { navId: `plan-${planId}` });
    const s = await offlineReload(env);
    log("alias/pointer-payload-mismatch/no-white-screen", !s.blank && !s.browserError, `mutation=${r}; ${s.ready ? "accepted payload" : s.appError ? "error UI" : "other"}`);
    log("alias/pointer-payload-mismatch/rejected", s.appError, s.appError ? "rejected" : "mismatched canonical payload accepted");
    await env.context.close();
  }

  // Force a post-payload synchronous alias failure. This is an adversarial transaction boundary test.
  {
    const planId = await createPlan("alias fail"); const env = await openSeeded(planId);
    await env.page.evaluate(async ({ id }) => new Promise((resolve, reject) => {
      const o = indexedDB.open("hike-nav-packs");
      o.onsuccess = () => {
        const tx = o.result.transaction(["routePacks", "aliases"], "readwrite");
        tx.objectStore("routePacks").delete(id);
        tx.objectStore("aliases").delete(id);
        tx.oncomplete = () => resolve(undefined);
        tx.onerror = () => reject(tx.error);
      };
      o.onerror = () => reject(o.error);
    }), { id: `plan-${planId}` });
    await env.page.goto(`${BASE}/plan/${planId}`, { waitUntil: "domcontentloaded" });
    await env.page.addInitScript(() => {}); // intentional no-op: keep test source browser compatible
    const outcome = await env.page.evaluate(async () => {
      const original = IDBObjectStore.prototype.put;
      let aliases = 0;
      IDBObjectStore.prototype.put = function(value) {
        if (this.name === "aliases") { aliases++; throw new DOMException("synthetic alias quota failure", "QuotaExceededError"); }
        return original.call(this, value);
      };
      try {
        // Click is driven outside evaluate; tell caller interception is installed.
        return { installed: true, aliases };
      } finally { /* restored after caller observes write */ }
    });
    await env.page.getByRole("button", { name: /prepare offline|update offline (?:pack|route)/i }).click(); await env.page.waitForTimeout(800);
    const state = await env.page.evaluate(async ({ id }) => new Promise((resolve, reject) => { const o = indexedDB.open("hike-nav-packs"); o.onsuccess = () => { const tx = o.result.transaction(["routePacks", "aliases"], "readonly"); const p = tx.objectStore("routePacks").get(id); const a = tx.objectStore("aliases").get(id); tx.oncomplete = () => resolve({ pack: p.result != null, alias: a.result != null }); tx.onerror = () => reject(tx.error); }; o.onerror = () => reject(o.error); }), { id: `plan-${planId}` });
    const text = await env.page.locator("body").innerText();
    // The wording is owned by formatOfflineRouteStorageError, which maps a
    // QuotaExceededError to plain recovery instructions instead of raw browser
    // text. Match the PROPERTY -- the UI admits the save failed and says what to
    // do -- not one exact sentence.
    const honest = /storage is full|could not save|failed to save|not saved|re-download/i.test(text)
      && !/route geometry and safety data are saved/i.test(text);
    log("quota/synchronous-alias-failure-honest-ui", honest, text.match(/.{0,40}(storage is full|could not save|failed to save|not saved|re-download).{0,90}/i)?.[0] ?? `no honest message; body=${text.slice(0, 160).replace(/\s+/g, " ")}`);
    log("quota/synchronous-alias-failure-atomic", !(state.pack && !state.alias), `${JSON.stringify(outcome)} state=${JSON.stringify(state)}`);
    await env.context.close();
  }

  // Service worker cache poisoning: current handler returns any cached response without content validation.
  {
    const planId = await createPlan("cache poison"); const env = await openSeeded(planId);
    await env.page.evaluate(async ({ url }) => { const c = await caches.open("hike-navigate-shell"); await c.put(url, new Response("<html><body>POISONED-SHELL</body></html>", { headers: { "content-type": "text/html" } })); }, { url: env.url });
    await env.context.setOffline(true); await env.page.goto(env.url, { waitUntil: "domcontentloaded" }).catch(() => {}); await env.page.waitForTimeout(500);
    const s = await screen(env.page); log("sw/cache-poisoning-degrades-safely", !/POISONED-SHELL/.test(s.text) && !s.blank, s.text.slice(0, 100));
    await env.context.close();
  }

  // Caches removed while offline: expect app fallback, not Chromium's network error.
  {
    const planId = await createPlan("cache deleted"); const env = await openSeeded(planId);
    await env.page.evaluate(async () => { for (const key of await caches.keys()) await caches.delete(key); });
    await env.context.setOffline(true); await env.page.goto(env.url, { waitUntil: "domcontentloaded" }).catch(() => {}); await env.page.waitForTimeout(500);
    const s = await screen(env.page); log("sw/cache-delete-offline-fallback", !s.browserError && !s.blank, s.text.slice(0, 110).replace(/\s+/g, " "));
    await env.context.close();
  }

  // Two tabs concurrently prepare/navigate against the same IDB record.
  {
    const planId = await createPlan("two tabs"); const context = await newOwnedContext({ permissions: ["geolocation"], geolocation: GEO, serviceWorkers: "allow" }); const a = await context.newPage(), b = await context.newPage();
    await Promise.all([a.goto(`${BASE}/plan/${planId}`), b.goto(`${BASE}/navigate/plan-${planId}`)]); await waitForController(a);
    const button = a.getByRole("button", { name: /prepare offline|update offline (?:pack|route)/i }); await button.click(); await b.waitForTimeout(1800);
    const first = await screen(b);
    if (!first.ready && !first.appError) {
      await b.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
      await b.waitForTimeout(800);
    }
    await completeReadinessIfShown(b);
    const s = await screen(b);
    log("idb/two-tab-prepare-navigate", !s.blank && !s.browserError && (s.ready || s.appError), s.text.slice(0, 100).replace(/\s+/g, " ")); await context.close();
  }

  // Clock-skew unit behaviors are rendered by controls only after opening safety panel; directly test persisted timestamp's visible display through navigation page.
  for (const [name, appliedAt, returnAt] of [["future", "2099-01-01T00:00:00.000Z", "2099-01-01T00:00:00.000Z"], ["epoch", "1970-01-01T00:00:00.000Z", "1970-01-01T00:00:00.000Z"]]) {
    const planId = await createPlan(`clock ${name}`); const env = await openSeeded(planId);
    await env.page.evaluate(async ({ appliedAt, returnAt }) => {
      const put = (dbName, stores, values) => new Promise((resolve, reject) => {
        const o = indexedDB.open(dbName);
        o.onupgradeneeded = () => {
          for (const store of stores) {
            if (!o.result.objectStoreNames.contains(store)) o.result.createObjectStore(store, { keyPath: "id" });
          }
        };
        o.onsuccess = () => {
          const names = stores.filter((store) => o.result.objectStoreNames.contains(store));
          const tx = o.result.transaction(names, "readwrite");
          for (const value of values) {
            const row = { ...value };
            delete row._store;
            tx.objectStore(value._store).put(row);
          }
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        };
        o.onerror = () => reject(o.error);
      });
      await put("hike-tourniquet", ["tourniquet"], [{ _store: "tourniquet", id: "current", appliedAt, limb: "leg" }]);
      // ICE + deadline: the checklist still prints OVERDUE; with ICE the HUD can unlock.
      await put("hike-safety", ["profile", "overdue"], [
        { _store: "overdue", id: "current", returnAt },
        { _store: "profile", id: "me", name: "Pat", iceName: "Sam", icePhone: "555-123-4567", medical: "", partySize: 1 },
      ]);
    }, { appliedAt, returnAt });
    await env.page.reload({ waitUntil: "domcontentloaded" });
    if (name === "epoch") {
      await env.page.waitForFunction(
        () => /OVERDUE by|Return time is invalid/i.test(document.body.innerText),
        null,
        { timeout: 10_000 },
      ).catch(() => {});
    } else {
      await env.page.waitForTimeout(800);
    }
    const t = (await screen(env.page)).text;
    log(`clock/${name}/overdue-not-reassuring`, name === "epoch" ? /OVERDUE by|invalid/i.test(t) : !/Return in 0 min/.test(t), t.match(/OVERDUE by [^—]+|Return in [^—]+|invalid[^—]*/i)?.[0]?.trim() ?? "no banner");
    await env.context.close();
  }
} finally {
  await browser.close();
}
const failed = results.filter(r => !r.ok);
console.log(`\nSUMMARY total=${results.length} failed=${failed.length}`);
for (const r of failed) console.log(`FAIL ${r.name} — ${r.detail}`);
process.exitCode = failed.length ? 1 : 0;
