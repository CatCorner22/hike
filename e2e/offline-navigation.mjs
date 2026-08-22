/**
 * Offline navigation end-to-end probe.
 *
 * Runs against a PRODUCTION build (`npm run build && npm start`) because the
 * Serwist service worker is disabled in development.
 *
 * Scenarios:
 *   A. Warm start  — navigate screen visited online, then reload offline.
 *   B. Cold start  — route pack prepared from the plan screen, navigate screen
 *                    NEVER opened online, then opened offline. This is the
 *                    realistic backcountry case: prepare at the trailhead with
 *                    signal, open navigation once you have lost it.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3111";
const GEO = { latitude: 37.7749, longitude: -119.5383 };

// A short synthetic route near the mocked GPS position.
const GEOMETRY = {
  type: "LineString",
  coordinates: Array.from({ length: 40 }, (_, i) => [
    -119.5383 + i * 0.0004,
    37.7749 + i * 0.0002,
  ]),
};

function log(scenario, status, detail) {
  const mark = status === "PASS" ? "PASS" : status === "FAIL" ? "FAIL" : "....";
  console.log(`[${mark}] ${scenario}${detail ? ` — ${detail}` : ""}`);
}

/**
 * Create the fixture plan from INSIDE the browser context.
 *
 * Plans are scoped to an anonymous device-owner cookie, so a plan created by
 * Node's fetch belongs to a different owner than the browser and correctly
 * 404s there. Creating it through the page keeps one cookie jar, which is also
 * what a real user does.
 */
async function createPlan(page, geometry) {
  const plan = await page.evaluate(async (geom) => {
    const res = await fetch("/api/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ name: "Offline probe route", customGeometry: geom }),
    });
    const text = await res.text();
    if (!res.ok) return { error: `${res.status} ${text}` };
    try {
      return { plan: JSON.parse(text) };
    } catch {
      return { error: `unparseable: ${text.slice(0, 200)}` };
    }
  }, geometry);

  if (plan.error) throw new Error(`plan create failed: ${plan.error}`);
  if (!plan.plan?.id) {
    throw new Error(`plan create returned no id: ${JSON.stringify(plan.plan)}`);
  }
  return plan.plan.id;
}

/**
 * Device-scoped ownership must isolate two ways:
 *   1. A cookie-less API call is refused outright (401) rather than being
 *      handed a fresh owner — otherwise a script could mint owners forever.
 *   2. A plan owned by one device is invisible (404) to another device, even
 *      though the UUID is known.
 * GPS tracks are a precise movement history tied to home trailheads, so this
 * is a location-privacy boundary, not just an access-control nicety.
 */
async function assertOwnershipIsolation(browser, page, planId) {
  const anon = await fetch(`${BASE}/api/plans`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "no-cookie plan", customGeometry: GEOMETRY }),
  });
  const refusesAnonymous = anon.status === 401;

  // A genuinely separate device: its own context, hence its own cookie jar.
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.goto(`${BASE}/plan`, { waitUntil: "domcontentloaded" });
  const crossDeviceStatus = await otherPage.evaluate(
    async (id) => (await fetch(`/api/plans/${id}`, { credentials: "same-origin" })).status,
    planId,
  );
  const ownerSeesIt = await page.evaluate(
    async (id) => (await fetch(`/api/plans/${id}`, { credentials: "same-origin" })).status,
    planId,
  );
  await other.close();

  return {
    ok: refusesAnonymous && crossDeviceStatus === 404 && ownerSeesIt === 200,
    detail: `anon POST -> ${anon.status} (want 401); other device GET -> ${crossDeviceStatus} (want 404); owner GET -> ${ownerSeesIt} (want 200)`,
  };
}

async function waitForServiceWorker(page) {
  await page.waitForFunction(
    () => navigator.serviceWorker?.controller != null,
    null,
    { timeout: 30_000 },
  );
}

/**
 * Navigate now refuses to unlock until ICE + return time are set.
 * Complete the checklist the way a hiker would — including offline.
 */
async function completeReadinessIfShown(page) {
  const checklist = page.locator("text=Pre-hike checklist");
  if ((await checklist.count()) === 0) return;
  await page.locator("#hiker").fill("Pat");
  await page.locator("#ice-name").fill("Sam");
  await page.locator("#ice-phone").fill("555-123-4567");
  const local = new Date(Date.now() + 4 * 3600_000);
  const value = new Date(local.getTime() - local.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
  await page.locator("#return").fill(value);
  await page.getByRole("button", { name: /Start navigation/i }).click();
  await page.waitForFunction(
    () => !document.body.innerText.includes("Pre-hike checklist"),
    null,
    { timeout: 15_000 },
  );
}

/** Does the navigate screen actually show navigation UI (not an error state)? */
/**
 * Clear the pre-hike checklist if it is showing.
 *
 * A readiness gate now stands in front of the navigate screen. It is a real
 * screen a hiker sees, so the harness goes through it rather than around it:
 * fill the ICE card and return time and start navigation. Falls back to the
 * explicit skip action, which exists because withholding an already-downloaded
 * map from someone who is already out cannot make them safer.
 */
async function clearReadinessGate(page) {
  // Wait for either the checklist or the map, so this cannot race the render.
  await Promise.race([
    page.getByText(/Pre-hike checklist/i).first().waitFor({ state: "visible", timeout: 12_000 }),
    page.locator("canvas").first().waitFor({ state: "visible", timeout: 12_000 }),
  ]).catch(() => {});
  if ((await page.getByText(/Pre-hike checklist/i).count().catch(() => 0)) === 0) return "not-shown";
  const fill = async (label, value) => {
    const field = page.getByLabel(label);
    if ((await field.count().catch(() => 0)) > 0) await field.first().fill(value);
  };
  await fill(/^Your name$/i, "E2E Hiker");
  await fill(/^ICE name$/i, "E2E Contact");
  await fill(/^ICE phone$/i, "+15555550123");
  const returnField = page.getByLabel(/Return by/i);
  if ((await returnField.count().catch(() => 0)) > 0) {
    const when = new Date(Date.now() + 6 * 3600 * 1000);
    const pad = (n) => String(n).padStart(2, "0");
    await returnField.first().fill(
      `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`,
    );
  }
  await page.getByRole("button", { name: /Start navigation/i }).click().catch(() => {});
  await page.waitForTimeout(900);
  if ((await page.getByText(/Pre-hike checklist/i).count().catch(() => 0)) > 0) {
    // Offline, persistence may refuse; the skip path must still work.
    await page
      .getByRole("button", { name: /Skip for now and show the map/i })
      .click()
      .catch(() => {});
    await page.waitForTimeout(900);
    return "skipped";
  }
  return "completed";
}

async function assessNavigateScreen(page) {
  await clearReadinessGate(page);
  const body = (await page.locator("body").innerText().catch(() => "")) || "";
  // Chrome's network error page, not our UI.
  const isBrowserErrorPage =
    /ERR_INTERNET_DISCONNECTED|ERR_FAILED|This site can[’']?t be reached|No internet/i.test(
      body,
    );
  // Positive signal: the navigate screen always renders a Zulu timestamp and
  // a USNG/MGRS grid string once a pack has loaded.
  const hasZulu = /\d{4}Z\s+\d{1,2}\s+[A-Z]{3}/.test(body);
  const hasGrid = /\b\d{1,2}[C-X]\s?[A-Z]{2}\b/.test(body);
  const svgCount = await page.locator("svg").count().catch(() => 0);
  const hasLoadError =
    /Invalid route id|not found on server|no route geometry|failed to save on device|cannot navigate safely/i.test(
      body,
    );
  return {
    ok: !isBrowserErrorPage && !hasLoadError && svgCount > 0 && (hasZulu || hasGrid),
    bodyLength: body.length,
    svgCount,
    signals: { isBrowserErrorPage, hasZulu, hasGrid, hasLoadError },
    excerpt: body.slice(0, 200).replace(/\s+/g, " "),
  };
}


/**
 * Grant durable (persistent) storage via CDP.
 *
 * Headless Chromium leaves the `persistent-storage` permission at "prompt", so
 * navigator.storage.persist() resolves false regardless of what the app does.
 * An installed PWA — the actual deployment target for this navigate screen —
 * has it granted. Playwright exposes no name for this permission, so grant it
 * through the DevTools Protocol to measure real app behavior.
 */
async function grantDurableStorage(browser, context, origin) {
  try {
    const session = await browser.newBrowserCDPSession();
    await session.send("Browser.grantPermissions", {
      origin,
      permissions: ["durableStorage"],
      browserContextId: undefined,
    });
    return true;
  } catch (err) {
    void context;
    console.log(`     (could not grant durableStorage: ${err.message.split("\n")[0]})`);
    return false;
  }
}

async function run() {
  const results = [];
  // CI installs a matching Chromium; other environments (including the review sandbox)
  // supply one out of band. Honour it or the probe is unrunnable there.
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  );

  // ---------- Scenario A: warm start ----------
  {
    const context = await browser.newContext({
      permissions: ["geolocation"],
      geolocation: GEO,
      serviceWorkers: "allow",
    });
    await grantDurableStorage(browser, context, BASE);
    const page = await context.newPage();
    // Establish the owner cookie and same-origin context before creating data.
    await page.goto(`${BASE}/plan`, { waitUntil: "domcontentloaded" });
    const planId = await createPlan(page, GEOMETRY);
    const navUrl = `${BASE}/navigate/plan-${planId}`;

    const isolation = await assertOwnershipIsolation(browser, page, planId);
    log("A0 device-scoped ownership isolates", isolation.ok ? "PASS" : "FAIL", isolation.detail);
    results.push(["A0: ownership isolation", isolation.ok]);

    await page.goto(navUrl, { waitUntil: "domcontentloaded" });
    await waitForServiceWorker(page);
    // Let the route pack persist to IndexedDB.
    await page.waitForTimeout(2500);
    await completeReadinessIfShown(page);

    const online = await assessNavigateScreen(page);
    log("A1 navigate online", online.ok ? "PASS" : "FAIL", JSON.stringify(online.signals) + " | " + online.excerpt);

    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForTimeout(2500);
    await completeReadinessIfShown(page);

    const offline = await assessNavigateScreen(page);
    log(
      "A2 navigate offline after warm visit",
      offline.ok ? "PASS" : "FAIL",
      JSON.stringify(offline.signals) + " | " + offline.excerpt,
    );
    results.push(["A: warm offline reload", offline.ok]);
    results.push(["A: navigate online", online.ok]);

    await context.close();
  }

  // ---------- Scenario B: cold start ----------
  {
    const context = await browser.newContext({
      permissions: ["geolocation"],
      geolocation: GEO,
      serviceWorkers: "allow",
    });
    await grantDurableStorage(browser, context, BASE);
    const page = await context.newPage();
    // Count real persist() invocations so we can assert the app asks for
    // durability, independently of whether the browser grants it.
    await page.addInitScript(() => {
      const s = navigator.storage;
      if (s && typeof s.persist === "function") {
        const original = s.persist.bind(s);
        s.persist = () => {
          try {
            const n = Number(localStorage.getItem("__persistCalls") ?? "0") + 1;
            localStorage.setItem("__persistCalls", String(n));
          } catch {
            /* ignore */
          }
          return original();
        };
      }
    });
    await page.goto(`${BASE}/plan`, { waitUntil: "domcontentloaded" });
    const planId = await createPlan(page, GEOMETRY);

    // Visit the plan detail screen online and register the SW.
    await page.goto(`${BASE}/plan/${planId}`, { waitUntil: "domcontentloaded" });
    await waitForServiceWorker(page);
    await page.waitForTimeout(1200);

    // Prepare the offline pack the way the UI does, without ever opening
    // the navigate screen.
    const prepared = await page.evaluate(async (geometry) => {
      const mod = await import("/_next/static/chunks/probe-noop.js").catch(
        () => null,
      );
      void mod;
      const btn = [...document.querySelectorAll("button")].find((b) =>
        /prepare offline|update offline (?:pack|route)/i.test(b.textContent || ""),
      );
      if (btn) {
        btn.click();
        return { via: "button" };
      }
      void geometry;
      return { via: "none" };
    }, GEOMETRY);

    if (prepared.via === "button") {
      await page.waitForFunction(
        () =>
          /Route saved|Route and navigation screen saved|Could not save|Navigation screen could not/i.test(
            document.body.innerText,
          ),
        null,
        { timeout: 35_000 },
      );
    }

    async function waitForVerifiedShell(url) {
      const deadline = Date.now() + 45_000;
      while (Date.now() < deadline) {
        const ok = await page.evaluate(async (target) => {
          const MARKER = "hike-navigate-shell-v2";
          try {
            const cache = await caches.open("hike-navigate-shell");
            const response = await cache.match(target, { ignoreSearch: true, ignoreVary: true });
            if (!response) return false;
            if (response.headers.get("x-hike-navigate-shell") === MARKER) return true;
            const html = await response.clone().text();
            return html.includes(MARKER);
          } catch {
            return false;
          }
        }, url);
        if (ok) return true;
        await page.waitForTimeout(500);
      }
      return false;
    }

    async function inspectPreparedOfflineFiles(url, id) {
      return page.evaluate(async ({ target, navId }) => {
        const marker = "hike-navigate-shell-v2";
        const result = {
          ok: false,
          shellValid: false,
          manifestValid: false,
          expectedAssets: 0,
          cachedAssets: 0,
          missingAssets: [],
          reason: "",
        };
        try {
          const shellCache = await caches.open("hike-navigate-shell");
          const shell = await shellCache.match(target, { ignoreSearch: true, ignoreVary: true });
          if (!shell) {
            result.reason = "route-specific shell is missing";
            return result;
          }
          const html = await shell.clone().text();
          result.shellValid =
            (shell.headers.get("x-hike-navigate-shell") === marker || html.includes(marker)) &&
            html.includes(`data-hike-navigate-shell="${navId}"`) &&
            /<!doctype html|<html[\s>]/i.test(html);
          const manifestUrl = new URL(`/__klandagi__/navigate-manifest/${encodeURIComponent(navId)}`, location.origin).toString();
          const manifestResponse = await shellCache.match(manifestUrl, { ignoreVary: true });
          const manifest = manifestResponse ? await manifestResponse.json().catch(() => null) : null;
          const unique = Array.isArray(manifest?.assetUrls) && new Set(manifest.assetUrls).size === manifest.assetUrls.length;
          result.manifestValid = Boolean(
            manifest &&
            manifest.version === 1 &&
            manifest.marker === marker &&
            manifest.navId === navId &&
            new URL(manifest.shellUrl).pathname === `/navigate/${encodeURIComponent(navId)}` &&
            unique &&
            manifest.assetUrls.length > 0 &&
            manifest.assetUrls.every((asset) => {
              const parsed = new URL(asset);
              return parsed.origin === location.origin && parsed.pathname.startsWith("/_next/static/");
            }),
          );
          if (!result.manifestValid) {
            result.reason = "route asset manifest is missing or invalid";
            return result;
          }
          result.expectedAssets = manifest.assetUrls.length;
          const assetCache = await caches.open("hike-navigate-assets");
          for (const asset of manifest.assetUrls) {
            const hit = await assetCache.match(asset, { ignoreVary: true });
            if (hit?.ok) result.cachedAssets += 1;
            else result.missingAssets.push(asset);
          }
          result.ok = result.shellValid && result.manifestValid && result.missingAssets.length === 0;
          result.reason = result.ok
            ? "route shell, manifest, and every listed app asset verified"
            : !result.shellValid
              ? "cached shell does not prove the requested route"
              : `${result.missingAssets.length} manifest assets are missing`;
          return result;
        } catch (error) {
          result.reason = String(error);
          return result;
        }
      }, { target: url, navId: id });
    }

    const navShellUrl = `${BASE}/navigate/plan-${planId}`;
    const preparedNavId = `plan-${planId}`;
    let shellCached = await waitForVerifiedShell(navShellUrl);
    if (!shellCached && prepared.via === "button") {
      log("B1 retry prepare", "....", "verified shell missing after save — warming again");
      await page.getByRole("button", { name: /prepare offline|update offline (?:pack|route)/i }).click();
      await page.waitForFunction(
        () =>
          /Route saved|Route and navigation screen saved|Could not save|Navigation screen could not/i.test(
            document.body.innerText,
          ),
        null,
        { timeout: 35_000 },
      );
      shellCached = await waitForVerifiedShell(navShellUrl);
    }
    const cacheAudit = await inspectPreparedOfflineFiles(navShellUrl, preparedNavId);
    const cacheKeys = await page.evaluate(async () => {
      try {
        const cache = await caches.open("hike-navigate-shell");
        const keys = await cache.keys();
        return keys.map((k) => (typeof k === "string" ? k : k.url)).slice(0, 12);
      } catch {
        return [];
      }
    });
    const assetCacheCount = await page.evaluate(async () => {
      try {
        const cache = await caches.open("hike-navigate-assets");
        return (await cache.keys()).length;
      } catch {
        return 0;
      }
    });
    log(
      "B1 prepare offline",
      prepared.via !== "none" && shellCached && cacheAudit.ok ? "PASS" : "FAIL",
      `via ${prepared.via}; shell cached=${shellCached}; manifest assets=${cacheAudit.cachedAssets}/${cacheAudit.expectedAssets}; ${cacheAudit.reason}; cache entries=${assetCacheCount}; keys=${cacheKeys.join(" | ")}`,
    );
    const prepareScreenText =
      (await page.locator("body").innerText().catch(() => "")) || "";
    if (!shellCached) {
      // Surface the app's own explanation in the CI log before B3 inevitably fails.
      log("B1a shell warming outcome", "....", prepareScreenText.slice(0, 300).replace(/\s+/g, " "));
    }

    const packCount = await page.evaluate(async () => {
      return await new Promise((resolve) => {
        const req = indexedDB.open("hike-nav-packs");
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("routePacks")) return resolve(-1);
          const tx = db.transaction("routePacks", "readonly");
          const all = tx.objectStore("routePacks").getAll();
          all.onsuccess = () => resolve(all.result.length);
          all.onerror = () => resolve(-2);
        };
        req.onerror = () => resolve(-3);
      });
    });
    log("B2 route packs in IndexedDB", packCount > 0 ? "PASS" : "FAIL", `count=${packCount}`);

    // Now go offline and cold-open the navigate screen for the first time.
    await page.waitForFunction(
      () => Boolean(navigator.serviceWorker?.controller),
      null,
      { timeout: 15_000 },
    );
    // Do not introduce an update/activation handoff immediately before going
    // offline. The hiker flow uses the already-active worker that just verified
    // this pack; forcing update() here made the test race a second worker.
    await page.waitForFunction(async () => {
      const registration = await navigator.serviceWorker?.ready;
      return Boolean(
        navigator.serviceWorker?.controller &&
        registration?.active?.state === "activated" &&
        !registration.installing &&
        !registration.waiting,
      );
    }, null, { timeout: 15_000 });
    await context.setOffline(true);

    // Prove the network is actually cut before judging B3, rather than assuming
    // setOffline did what it says. Cold offline navigate is the app's single most
    // important promise, and a B3 that passes because the worker quietly reached the
    // live server would be a green light proving nothing. Offline enforcement for
    // service-worker fetches is environment-dependent, so check it instead of
    // trusting it: /api/ is NetworkOnly in the worker, so any response at all here
    // means the worker still has a network and B3's result is not evidence.
    const workerStillOnline = await page
      .evaluate(async (url) => {
        try {
          const response = await fetch(url, { cache: "no-store" });
          return response.status > 0;
        } catch {
          return false;
        }
      }, `${BASE}/api/trails/search?q=offline-probe-network-check`)
      .catch(() => false);
    if (workerStillOnline) {
      log(
        "B3b offline is not enforced for the service worker",
        "FAIL",
        "setOffline did not cut the worker's network, so B3 below does not prove the cached shell was used. Run the CI job, or stop the server before the cold open, to test this for real.",
      );
    }
    const navUrl = `${BASE}/navigate/plan-${planId}`;
    async function coldNavigateOnce() {
      let navError = null;
      let navigationResponse = null;
      const response = await page
        .goto(navUrl, { waitUntil: "domcontentloaded", timeout: 20_000 })
        .catch((e) => {
          navError = e.message.split("\n")[0];
          return null;
        });
      if (response) {
        navigationResponse = {
          url: response.url(),
          status: response.status(),
          source:
            response.headers()["x-hike-navigate-shell"] ??
            response.headers()["x-hike-offline-shell"] ??
            null,
        };
      }
      await page.waitForTimeout(2500);
      if (!navError) await completeReadinessIfShown(page);
      return navError
        ? { ok: false, excerpt: `navigation threw: ${navError}`, navigationResponse }
        : { ...(await assessNavigateScreen(page)), navigationResponse };
    }
    const cold = await coldNavigateOnce();
    const usedVerifiedShell =
      cold.navigationResponse?.source === "hike-navigate-shell-v2";
    const verifiedColdStart = !workerStillOnline && cold.ok && usedVerifiedShell;
    log(
      "B3 cold offline navigate",
      verifiedColdStart ? "PASS" : "FAIL",
      `${workerStillOnline ? `${cold.excerpt} [*network not actually cut — see B3b]` : cold.excerpt} | response=${JSON.stringify(cold.navigationResponse)}`,
    );
    if (!verifiedColdStart) {
      // B1 already proved the shell is in Cache Storage, so a failure here means the
      // service worker's own lookup disagreed with the probe's. Report the state it
      // would have seen rather than leaving the next reader to guess: this scenario
      // passes locally and has only ever failed on a slower CI runner.
      const why = await page
        .evaluate(async (url) => {
          const out = { controller: null, registration: null, cacheNames: [], shellKeys: [], entry: null };
          try {
            out.controller = navigator.serviceWorker?.controller?.scriptURL ?? null;
            const reg = await navigator.serviceWorker?.getRegistration?.();
            out.registration = reg
              ? {
                  scope: reg.scope,
                  installing: reg.installing?.state ?? null,
                  waiting: reg.waiting?.state ?? null,
                  active: reg.active?.state ?? null,
                }
              : null;
          } catch (error) {
            out.registration = `threw: ${String(error)}`;
          }
          try {
            out.cacheNames = await caches.keys();
            const cache = await caches.open("hike-navigate-shell");
            out.shellKeys = (await cache.keys()).map((k) => (typeof k === "string" ? k : k.url));
            const hit = await cache.match(url, { ignoreSearch: true, ignoreVary: true });
            if (hit) {
              const body = await hit.clone().text();
              out.entry = {
                status: hit.status,
                contentType: hit.headers.get("content-type"),
                contentEncoding: hit.headers.get("content-encoding"),
                contentLength: hit.headers.get("content-length"),
                markerHeader: hit.headers.get("x-hike-navigate-shell"),
                bytes: body.length,
                markerInBody: body.includes("hike-navigate-shell-v2"),
                // The predicate sw.ts actually gates on.
                looksLikeNavigateHtml:
                  body.length >= 512 &&
                  /<!doctype html|<html[\s>]/i.test(body) &&
                  /_next\/|self\.__next_f|<body[\s>]/i.test(body),
              };
            }
          } catch (error) {
            out.entry = `threw: ${String(error)}`;
          }
          return out;
        }, navUrl)
        .catch((error) => ({ evaluateFailed: String(error) }));
      log("B3a why the shell was not served", "....", JSON.stringify(why).slice(0, 1200));
    }
    results.push([
      "B: cold offline navigate via verified shell",
      verifiedColdStart && shellCached && cacheAudit.ok,
    ]);

    // Storage durability.
    //
    // navigator.storage.persist() cannot be granted in headless Chromium (nor
    // in headed chromium here): the persistent-storage permission stays at
    // "prompt" and persist() resolves false even after a CDP durableStorage
    // grant. Asserting persisted === true would therefore test the browser, not
    // the app. What matters, and what IS verifiable, is that the app actually
    // requests durability and reports the outcome honestly instead of implying
    // the pack is safe.
    const durability = await page.evaluate(() => {
      let calls = 0;
      try {
        calls = Number(localStorage.getItem("__persistCalls") ?? "0");
      } catch {
        /* ignore */
      }
      return { requested: calls > 0, calls };
    });
    const storage = await page.evaluate(async () => {
      const persisted =
        (await navigator.storage?.persisted?.().catch(() => null)) ?? null;
      let estimate = null;
      try {
        const e = await navigator.storage.estimate();
        estimate = { usage: e.usage, quota: e.quota };
      } catch {
        /* ignore */
      }
      return { persisted, estimate };
    });
    log(
      "B4 app requested durable storage",
      durability.requested ? "PASS" : "FAIL",
      `persist() calls=${durability.calls} persisted=${storage.persisted} usage=${storage.estimate?.usage}`,
    );
    results.push(["B4: app requested durable storage", durability.requested]);

    // When the browser refuses, the UI must say so rather than claim safety.
    const warnsOnRefusal =
      storage.persisted === true ||
      /evict|may be removed|not permanent|keep the app|reclaim/i.test(
        prepareScreenText,
      );
    log(
      "B5 UI is honest about eviction risk",
      warnsOnRefusal ? "PASS" : "WARN",
      warnsOnRefusal ? "warning surfaced" : "no eviction warning found on this screen",
    );

    await context.close();
  }

  await browser.close();

  console.log("\n==== SUMMARY ====");
  let failures = 0;
  for (const [name, ok] of results) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
    if (!ok) failures++;
  }
  process.exit(failures > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("probe crashed:", err);
  process.exit(2);
});
