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
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:3111";
const TILE_GLOB = "**/tiles.openfreemap.org/**";

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

// --- 2. a working basemap stays quiet ----------------------------------------
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
