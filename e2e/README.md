# Offline navigation regression test

`offline-navigation.mjs` guards the one failure mode that matters most in this
app: opening the navigate screen for the first time with no signal.

## Why it exists

The service worker caches `/navigate/*` with `NetworkFirst`, and
`/navigate/[planId]` is server-rendered on demand — so it never lands in the
Serwist precache manifest. That meant the realistic backcountry flow was broken:

1. Prepare the offline pack at the trailhead while you still have signal.
2. Lose signal.
3. Open navigation for the first time.

The route pack was sitting in IndexedDB, but the HTML document had never been
cached, so the page could not boot at all — Chrome's network error page, not a
degraded map. `warmNavigateShell()` now caches the document and its
`/_next/static/**` dependencies at prepare time, and this test locks that in.

## Running it

The service worker is disabled in development, so this must run against a
production build:

```bash
npm run build
npx next start --port 3111 &
BASE=http://127.0.0.1:3111 npm run test:offline
```

Requires a Chromium browser for Playwright:

```bash
npx playwright install chromium
```

## What it asserts

| Check | Meaning |
| --- | --- |
| A1 | Navigate screen works online |
| A2 | Navigate screen survives an offline reload after a warm visit |
| B1 | Prepare-offline completes from the plan screen |
| B2 | Exactly one route-pack payload is stored — no alias duplication |
| B3 | **Cold** offline open of a never-visited navigate URL works |
| B4 | The app requests durable storage during prepare |
| B5 | The UI warns honestly when the browser refuses persistence |

## A note on B4

`navigator.storage.persist()` cannot be granted in headless Chromium — the
`persistent-storage` permission stays at `prompt` and `persist()` resolves
`false`, even after a CDP `durableStorage` grant. Asserting `persisted === true`
would therefore test the browser, not the app.

So B4 instruments `navigator.storage.persist` and asserts the app *calls* it,
and B5 asserts the UI tells the truth when the browser says no. An installed PWA
gets persistence granted; a hiker deserves to be told when it was not.
