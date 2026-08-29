/*
 * The background map needs the network. What happens when it does not answer?
 *
 * Found by driving every page with the tile host unreachable: the map rendered
 * as an empty box. No message, no retry, and because MapLibre's `load` event
 * never fires, no `fitBounds` either — so it was not even pointing at the trail
 * it was supposed to show. To a person at a trailhead with one bar, a blank map
 * is indistinguishable from "there is nothing here", which is the one reading
 * this app must never allow.
 *
 * Two things are checked, and the second matters as much as the first:
 *   1. a failed basemap says so, and offers a way to try again
 *   2. a working basemap says nothing — a banner that cried wolf on a map that
 *      loaded fine would train people to ignore it
 */
import { deflateSync } from "node:zlib";
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:3111";
const TILE_ORIGIN = "https://tiles.openfreemap.org";
const TILE_GLOB = `${TILE_ORIGIN}/**`;

/**
 * A real 256x256 tile.
 *
 * A 1x1 PNG will not do, and this cost a debugging cycle worth recording: served
 * as a raster tile it is rejected, so every tile — the "successful" one
 * included — lands in state `errored`, and a partial-success case written that
 * way tests nothing. Built here the same dependency-free way
 * `scripts/generate-icons.mjs` builds the app icons.
 */
function tilePng(size = 256) {
  const crc32 = (buf) => {
    let c = ~0;
    for (const b of buf) {
      c ^= b;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    return ~c >>> 0;
  };
  const chunk = (type, data) => {
    const t = Buffer.from(type);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, crc]);
  };
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const i = row + 1 + x * 3;
      raw[i] = 200;
      raw[i + 1] = 210;
      raw[i + 2] = 200;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const PNG_TILE = tilePng();

/** A valid style that does reference tiles, so there is something to fail. */
function rasterStyle() {
  return {
    version: 8,
    sources: {
      base: { type: "raster", tiles: [`${TILE_ORIGIN}/r/{z}/{x}/{y}.png`], tileSize: 256 },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#dddddd" } },
      { id: "r", type: "raster", source: "base" },
    ],
  };
}

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) failures += 1;
}

const browser = await chromium.launch({
  headless: true,
  // Match the sibling probes: omit the key entirely when the variable is
  // unset, rather than passing `executablePath: undefined`. CI installs its
  // own browser and sets nothing.
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
});

async function openExplore({ blockTiles }) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  if (blockTiles) {
    await page.route(TILE_GLOB, (route) => route.abort());
  } else {
    // Serve a minimal but valid style so the probe does not depend on a third
    // party being up. This is the "basemap works" control.
    await page.route(TILE_GLOB, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ version: 8, sources: {}, layers: [] }),
      }),
    );
  }
  await page.goto(`${BASE}/explore`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(6_000);
  return { ctx, page };
}

// --- 1. the failure is stated, and recoverable -------------------------------
{
  const { ctx, page } = await openExplore({ blockTiles: true });
  const text = await page.innerText("body");
  check(
    "a basemap that will not load says so",
    /background map could not be loaded/i.test(text),
    `screen read: ${JSON.stringify(text.replace(/\s+/g, " ").slice(0, 160))}`,
  );
  check(
    "it says what still works, so the screen is not a dead end",
    /offline/i.test(text) && /trail details/i.test(text),
  );
  const retry = page.getByRole("button", { name: /try again/i });
  check("it offers a way to try again", (await retry.count()) > 0);

  // A retry is the slowest thing on this screen when the connection is weak.
  // Clearing the notice on the button press put the user back in front of a
  // blank box — the same dead end the notice exists to prevent. So the notice
  // must stand for the whole attempt, and the attempt must be acknowledged.
  if ((await retry.count()) > 0) {
    await retry.first().click();
    let acknowledged = true;
    try {
      await page.getByText(/trying again/i).first().waitFor({ state: "visible", timeout: 5_000 });
    } catch {
      acknowledged = false;
    }
    check("a retry says it is trying, rather than going blank while it works", acknowledged);
    // And whichever way it lands, the screen never goes quiet: the notice holds
    // until the attempt resolves, so there is no window with nothing to read.
    // This is checked without a settling delay precisely because a timing
    // assumption here is what a slow runner breaks.
    check(
      "a retry that fails again still says so, rather than going blank",
      /background map could not be loaded/i.test(await page.innerText("body")),
    );
  }
  await ctx.close();
}

// --- 2. the style loads but its tiles do not ---------------------------------
// MapLibre fires `load` even when every tile errored, because a source that
// errored and a tile in state `errored` both count as settled. The notice was
// raised on the first tile error and then erased by that `load`.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  let tileRequests = 0;
  // Raster rather than vector on purpose: MapLibre fetches vector tiles inside a
  // worker, which page routing does not intercept, so a vector case would assert
  // against zero requests and pass no matter what the app did.
  const style = rasterStyle();
  await page.route(TILE_GLOB, (route) => {
    if (route.request().url().includes("/styles/")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(style),
      });
    }
    tileRequests += 1;
    return route.abort();
  });
  await page.goto(`${BASE}/explore`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(9_000);
  check(
    "the tile host being down is a real request, not an assertion against nothing",
    tileRequests > 0,
    `saw ${tileRequests} tile requests`,
  );
  check(
    "a style that loads with no tiles behind it still warns",
    /background map could not be loaded/i.test(await page.innerText("body")),
    "load fired on an all-errored source and cleared the notice",
  );
  await ctx.close();
}

// --- 3. every tile 404s ------------------------------------------------------
// MapLibre raises no ErrorEvent at all for a 404 tile (`tile/tile_manager.ts`
// fires it only `if (err.status !== 404)`), so a detector that asks about
// errors sees a clean run and clears the notice over a blank map.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  let tileRequests = 0;
  await page.route(TILE_GLOB, (route) => {
    if (route.request().url().includes("/styles/")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(rasterStyle()),
      });
    }
    tileRequests += 1;
    return route.fulfill({ status: 404, contentType: "text/plain", body: "no tile" });
  });
  await page.goto(`${BASE}/explore`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(9_000);
  check("the all-404 case actually requested tiles", tileRequests > 0, `saw ${tileRequests}`);
  check(
    "a basemap whose every tile 404s still warns, though nothing errored",
    /background map could not be loaded/i.test(await page.innerText("body")),
  );
  await ctx.close();
}

// --- 4. one tile through, the rest failing, is a usable map ------------------
// `isSourceLoaded` reports the whole source settling, not this tile, so gating
// on it threw away tiles that had genuinely arrived and warned over a map that
// was drawing.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  let served = 0;
  let delivered = 0;
  await page.route(TILE_GLOB, async (route) => {
    if (route.request().url().includes("/styles/")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(rasterStyle()),
      });
    }
    served += 1;
    // The first tile succeeds while its siblings are still outstanding, which is
    // exactly when `isSourceLoaded` is false; the rest then fail.
    if (served === 1) {
      delivered += 1;
      return route.fulfill({ status: 200, contentType: "image/png", body: PNG_TILE });
    }
    // 404 rather than abort: a missing tile is the realistic sibling failure,
    // and unlike an abort it leaves nothing hanging in `loading` for ever —
    // which would be a stalled map, not a partial one.
    return route.fulfill({ status: 404, contentType: "text/plain", body: "no tile" });
  });
  await page.goto(`${BASE}/explore`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(9_000);
  check("the partial case served exactly one real tile", delivered === 1, `delivered ${delivered}`);
  check(
    "a map with one tile through is not blanked over the others",
    !/background map could not be loaded/i.test(await page.innerText("body")),
  );
  await ctx.close();
}

// --- 5. the good tile is still in flight when `load` arrives -----------------
// The case that makes the settle wait necessary. A source whose tiles errored
// reports itself settled, so `load` fires while a good tile is outstanding;
// measured directly, tile state at that moment reads
// ["errored","errored","loading","errored",...]. Judging on that snapshot
// blanks a map that is about to draw.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  let served = 0;
  await page.route(TILE_GLOB, async (route) => {
    if (route.request().url().includes("/styles/")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(rasterStyle()),
      });
    }
    served += 1;
    if (served === 1) {
      // Held back deliberately, so it is unresolved when the siblings settle.
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      return route.fulfill({ status: 200, contentType: "image/png", body: PNG_TILE });
    }
    // Aborted, not 404. Only a non-404 failure raises the ErrorEvent that marks
    // the source errored, and only an errored source reports itself settled
    // early — which is what makes `load` arrive before the held-back tile.
    return route.abort();
  });
  await page.goto(`${BASE}/explore`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(12_000);
  check(
    "a tile still arriving when the map calls itself loaded is waited for",
    !/background map could not be loaded/i.test(await page.innerText("body")),
  );
  await ctx.close();
}

// --- 6. a working basemap stays quiet ----------------------------------------
{
  const { ctx, page } = await openExplore({ blockTiles: false });
  const text = await page.innerText("body");
  check(
    "a basemap that loads shows no warning",
    !/background map could not be loaded/i.test(text),
    `screen read: ${JSON.stringify(text.replace(/\s+/g, " ").slice(0, 160))}`,
  );
  await ctx.close();
}

await browser.close();
console.log(`\nSUMMARY failed=${failures}`);
process.exit(failures === 0 ? 0 : 1);
