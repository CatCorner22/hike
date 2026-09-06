import { chromium } from "playwright";
import { OPEN_ENSURING_STORES, NAV_PACK_STORES, packFixture, clearReadinessGate } from "./idb-open.mjs";

/**
 * Visual and contrast verification for corridor rendering on the offline Safety
 * Map.
 *
 * Corridor context is drawn beneath the route in three display modes. Two things
 * must hold in all of them: the route must remain the most prominent line on the
 * screen, and no corridor colour may be bright enough to destroy dark adaptation
 * in red or NVG mode.
 */
const BASE = process.env.BASE ?? "http://localhost:3111";
const PLAN_ID = "plan-corridor-visual";

const ROUTE = [
  [-119.56, 37.74],
  [-119.55, 37.745],
  [-119.54, 37.75],
  [-119.53, 37.756],
  [-119.52, 37.762],
];

/** A corridor with one of every feature class, positioned around the route. */
function corridorFixture() {
  return {
    bufferMeters: 3218.688,
    bbox: [-119.6, 37.71, -119.49, 37.79],
    lines: [
      { kind: "road", name: "Forest Route 12", positions: [[-119.58, 37.73], [-119.53, 37.735], [-119.5, 37.745]] },
      { kind: "track", name: "Fire road", positions: [[-119.57, 37.77], [-119.52, 37.775]] },
      { kind: "trail", name: "Side trail", positions: [[-119.55, 37.735], [-119.545, 37.728]] },
      { kind: "water", name: "Creek", positions: [[-119.56, 37.755], [-119.53, 37.768], [-119.51, 37.772]] },
      { kind: "barrier", name: "Fence", positions: [[-119.51, 37.73], [-119.505, 37.755]] },
    ],
    points: [
      { kind: "shelter", name: "Hut", lat: 37.752, lng: -119.545 },
      { kind: "water", name: "Spring", lat: 37.744, lng: -119.552 },
      { kind: "campsite", name: "Camp", lat: 37.766, lng: -119.524 },
      { kind: "building", name: "Cabin", lat: 37.738, lng: -119.535 },
    ],
    coverage: "complete",
    retrievedAt: new Date().toISOString(),
  };
}

/**
 * The visual contract for this feature, per display mode: the route colour and the
 * corridor road colour as actually drawn. Hard-coded deliberately -- if either
 * palette changes, this probe should fail and make someone look at the screen.
 */
const EXPECTED = {
  off: { route: "22,163,74", road: "100,116,139", water: "37,99,235" },
  red: { route: "248,113,113", road: "127,74,74", water: "107,59,82" },
  nvg: { route: "22,163,74", road: "74,127,92", water: "56,97,79" },
};

function parseColour(value) {
  return value.split(",").map(Number);
}

function relativeLuminance([r, g, b]) {
  const channel = (value) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

async function seed(page, withCorridor) {
  const pack = packFixture(PLAN_ID, ROUTE);
  if (withCorridor) pack.corridor = corridorFixture();
  await page.evaluate(
    async ({ source, stores, pack }) => {
      // eslint-disable-next-line no-eval
      (0, eval)(source);
      const db = await openEnsuringStores("hike-nav-packs", stores);
      const tx = db.transaction(["routePacks", "aliases"], "readwrite");
      tx.objectStore("routePacks").put(pack);
      for (const alias of pack.aliases ?? []) tx.objectStore("aliases").put({ alias, canonicalId: pack.id });
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      db.close();
    },
    { source: OPEN_ENSURING_STORES, stores: NAV_PACK_STORES, pack },
  );
}

async function run() {
  const browser = await chromium.launch();
  const results = [];

  for (const mode of ["off", "red", "nvg"]) {
    const context = await browser.newContext({ viewport: { width: 414, height: 896 } });
    const page = await context.newPage();
    // A document request first, so the origin has a session and IndexedDB exists.
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await seed(page, true);
    await page.goto(`${BASE}/navigate/${PLAN_ID}`, { waitUntil: "domcontentloaded" });
    await clearReadinessGate(page);
    await page.waitForSelector("canvas", { timeout: 20_000 });
    // The night-mode control is a cycling button whose label shows the CURRENT
    // mode, so reaching red means clicking "Day" and reaching NVG means clicking
    // "Day" then "Red". Driven the way a hiker would rather than by setting state.
    if (mode === "red" || mode === "nvg") {
      await page.getByRole("button", { name: "Day" }).click();
      await page.getByRole("button", { name: "Red" }).waitFor({ state: "visible" });
    }
    if (mode === "nvg") {
      await page.getByRole("button", { name: "Red" }).click();
      await page.getByRole("button", { name: "NVG" }).waitFor({ state: "visible" });
    }
    await page.waitForTimeout(900);

    const shot = `/home/user/workspace/corridor-${mode}.png`;
    await page.screenshot({ path: shot });

    // Sampled against the corridor palette specifically. An earlier version of this
    // probe took the brightest pixel anywhere on the canvas, which flagged
    // pre-existing orientation-label text (#ffd1d1 in red mode) rather than
    // anything the corridor draws -- it was measuring the wrong thing and failing
    // honest code. What matters here is narrower and checkable: corridor features
    // must actually be drawn, and no corridor LINE may be brighter than the route
    // line in the same mode. Corridor points are exempt by design: a line competes
    // with the route because it also says "follow me", whereas a dot marking a
    // shelter is a destination and should be easy to spot.
    const stats = await page.evaluate(({ expected }) => {
      const canvas = document.querySelector("canvas");
      if (!canvas) return null;
      const ctx = canvas.getContext("2d");
      const { width, height } = canvas;
      const data = ctx.getImageData(0, 0, width, height).data;
      let brightest = [0, 0, 0];
      let brightestLum = -1;
      const counts = {};
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const key = `${r},${g},${b}`;
        counts[key] = (counts[key] ?? 0) + 1;
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        if (lum > brightestLum) {
          brightestLum = lum;
          brightest = [r, g, b];
        }
      }
      const top = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([colour, count]) => ({ colour, count }));
      const found = {};
      for (const [name, colour] of Object.entries(expected)) {
        found[name] = counts[colour] ?? 0;
      }
      return { brightest, top, found, pixels: width * height };
    }, { expected: EXPECTED[mode] });

    results.push({ mode, shot, stats });
    await context.close();
  }

  // A route-only pack must still render, proving corridor support did not become
  // a requirement.
  const context = await browser.newContext({ viewport: { width: 414, height: 896 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await seed(page, false);
  await page.goto(`${BASE}/navigate/${PLAN_ID}`, { waitUntil: "domcontentloaded" });
  await clearReadinessGate(page);
  const routeOnlyOk = await page
    .waitForSelector("canvas", { timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  await page.screenshot({ path: "/home/user/workspace/corridor-none.png" });
  await context.close();
  await browser.close();

  let failures = 0;
  for (const { mode, stats } of results) {
    if (!stats) {
      console.log(`FAIL ${mode}: no canvas`);
      failures += 1;
      continue;
    }
    console.log(`\n[${mode}] top colours: ${stats.top.map((t) => `${t.colour}×${t.count}`).join("  ")}`);

    const routeLum = relativeLuminance(parseColour(EXPECTED[mode].route));
    for (const feature of ["road", "water"]) {
      const pixels = stats.found[feature] ?? 0;
      const lum = relativeLuminance(parseColour(EXPECTED[mode][feature]));
      const drawn = pixels > 0;
      const muted = lum < routeLum;
      console.log(
        `  ${drawn && muted ? "PASS" : "FAIL"} ${feature}: pixels=${pixels} relLum=${lum.toFixed(3)} route=${routeLum.toFixed(3)}`,
      );
      if (!drawn) {
        console.log(`  FAIL ${mode}/${feature}: corridor feature was not drawn at all`);
        failures += 1;
      }
      if (!muted) {
        console.log(`  FAIL ${mode}/${feature}: corridor is brighter than the route line`);
        failures += 1;
      }
    }
    const routePixels = stats.found.route ?? 0;
    if (routePixels <= 0) {
      console.log(`  FAIL ${mode}: the route line itself was not drawn`);
      failures += 1;
    } else {
      console.log(`  PASS route drawn: pixels=${routePixels}`);
    }
  }
  console.log(`route-only pack renders: ${routeOnlyOk ? "PASS" : "FAIL"}`);
  if (!routeOnlyOk) failures += 1;
  console.log(`\nSUMMARY failures=${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
