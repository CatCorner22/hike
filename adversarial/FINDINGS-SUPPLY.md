# Build and supply chain — adversarial findings

## Summary

**HIGH: 1, MEDIUM: 1, LOW: 1.** The production dependency tree has no audit
findings, lockfile integrity is complete, and per-owner APIs are `no-store`.
The material weaknesses are a cacheable document response that mints a
per-owner credential, and unbounded/uninterruptible external data reads during
offline preparation. The service worker is deliberately defensive for the
known cached-shell issue; I did not re-report that known item.

## F-01 Cacheable document response can distribute a per-owner session cookie — HIGH

**Hiker consequence:** On a shared/CDN cache that replays this response, one
hiker can receive another hiker's signed owner cookie and then see or alter
the other hiker's saved plans and location-bearing activity records.

**Where:** `src/proxy.ts:53-59`; the live `/plan` response.

**Reproduction:**

    cd /home/user/workspace/hike && curl -sS -D - -o /dev/null -H 'Accept: text/html' http://127.0.0.1:3111/plan | grep -iE 'HTTP/|set-cookie|cache-control'

    HTTP/1.1 200 OK
    set-cookie: hike_owner=caacfc69-bb30-4394-bf31-0f2ce4f43518.qcQsJ-Ce1VQ7tI51KaEmkBiU4rOs5__uUdhH7Cer7w0; Path=/; Expires=Fri, 20 Aug 2027 19:41:52 GMT; Max-Age=31536000; Secure; HttpOnly; SameSite=lax
    Cache-Control: s-maxage=31536000

    cd /home/user/workspace/hike && token=$(SESSION_SECRET=e2e npx tsx -e 'import { signOwnerToken } from "./src/lib/auth/owner"; (async()=>console.log(await signOwnerToken("supply-cache-probe")))()') && curl -sS -D - -o /dev/null -H "Cookie: hike_owner=$token" http://127.0.0.1:3111/api/plans

    HTTP/1.1 200 OK
    Cache-Control: no-store
    content-type: application/json

**Why it happens:** A first document navigation creates a signed,
year-lived `hike_owner` cookie (`src/proxy.ts:53-58`). The generated static
`/plan` document simultaneously advertises `s-maxage=31536000`; `s-maxage`
explicitly authorizes shared caching, and the response has no `Vary: Cookie`.
The API correctly refuses shared caching, but that does not protect the
credential if a shared cache serves the document and its `Set-Cookie` header
to a later visitor.

**Suggested fix:** Ensure every response which can mint `hike_owner` is
`Cache-Control: private, no-store` (or mint on a dedicated, no-store endpoint
and strip `Set-Cookie` from cacheable documents). Verify the CDN is configured
not to cache or replay `Set-Cookie`; do not rely on that non-universal
behavior. Preserve the existing API `no-store` policy.

**Confidence:** **Medium.** The conflicting `Set-Cookie` and one-year
`s-maxage` headers were reproduced from the running production server. I
could not place an actual shared CDN in front of `127.0.0.1`, so cache replay
itself is not demonstrated here.

## F-02 Offline preparation trusts two remote responses with no deadline or size limit — MEDIUM

**Hiker consequence:** A slow or hostile elevation/weather service can leave
“Prepare offline” spinning indefinitely before the route pack is stored, so a
hiker may depart believing preparation is in progress while no usable offline
pack exists.

**Where:** `src/lib/geo/index.ts:250-277`,
`src/lib/offline/pack-weather.ts:10-42`, and
`src/components/offline/prepare-offline.tsx:47-75`.

**Reproduction:**

    cd /home/user/workspace/hike && npx vitest run adversarial/probe-supply-external.test.ts --reporter=verbose

    [
      {
        "url": "https://api.open-elevation.com/api/v1/lookup",
        "signal": false,
        "body": "{\"locations\":[{\"latitude\":40,\"longitude\":-110},{\"latitude\":40.1,\"longitude\":-110.1}]}"
      },
      {
        "url": "https://api.open-meteo.com/v1/forecast?latitude=40&longitude=-110&current=temperature_2m%2Crelative_humidity_2m%2Cwind_speed_10m&wind_speed_unit=kmh&timezone=auto",
        "signal": false
      },
      {
        "url": "https://overpass-api.de/api/interpreter",
        "signal": true,
        "body": "data=..."
      }
    ]
    ✓ adversarial/probe-supply-external.test.ts > supply external data request controls > records abort-signal use for elevation, weather, and Overpass

    cd /home/user/workspace/hike && grep -RInE 'redirect:|content-length|Content-Length|arrayBuffer\(|byteLength|response\.headers' src/lib/osm/overpass.ts src/lib/geo/index.ts src/lib/nps/client.ts src/lib/offline/pack-weather.ts src/lib/research/agent.ts src/lib/api/outbound.ts || true

    [no output]

**Why it happens:** Elevation calls bare `fetch()` and weather calls bare
`fetch(..., { cache: "no-store" })`, then each consumes `response.json()`;
neither provides an abort signal, a body-byte ceiling, content-type check, or
redirect policy. `PrepareOffline.prepare()` awaits weather before calling
`persistRoutePack`. The test intercepts those exact calls and proves that
their `RequestInit.signal` is absent. A default fetch also follows redirects.

For completeness, the other external sources are only partially hardened:
Overpass has a 2.5 s abort timeout and a fixed HTTPS mirror list; NPS has a
5 s abort timeout; both still use unbounded `response.json()` with no
content-type/schema/redirect enforcement. All four fixed endpoint origins use
HTTPS, and no user-controlled URL reaches `fetch`, so I found **no SSRF**
path. Elevation verifies finite elevation values after parsing; NPS and
Overpass largely type-cast their JSON rather than validating an input schema.

**Suggested fix:** Put every external fetch behind one shared helper that:
uses a deadline/abort signal, sets `redirect: "error"` (or validates the final
origin against an allowlist), rejects unexpected content types, streams with a
strict byte limit before JSON parsing, and parses an explicit bounded schema.
For pack preparation, allow route storage to continue after a short weather
deadline and present “weather snapshot unavailable,” rather than blocking the
whole safety pack.

**Confidence:** **High.** The source path and a runnable interception probe
show absence of signals and every requested cap control; the user-facing
ordering is directly visible in `prepare()`.

## F-03 Client JavaScript leaks an absolute build filesystem path — LOW

**Hiker consequence:** There is no direct navigational effect, but a
downloaded client bundle discloses the server/workspace layout that can help
an attacker tailor a subsequent compromise of the app hikers rely on.

**Where:** generated
`.next/static/chunks/ca4dcb09.e0de024e79c56204.js` (MapLibre worker URL).

**Reproduction:**

    cd /home/user/workspace/hike && grep -RIlF '/home/user/' .next/static 2>/dev/null | while read f; do echo "--- $f"; grep -oE '.{0,80}/home/user/.{0,160}' "$f" | head -5; done

    --- .next/static/chunks/ca4dcb09.e0de024e79c56204.js
    bjectURL(r)}async function eu(){let t=T.In.WORKER_URL||function(){let t="file:///home/user/workspace/hike/node_modules/maplibre-gl/dist/maplibre-gl.mjs";if(!/^https?:/.test(t))return"";
    n eh(t,i);if(i){let r,a=(r=new Blob([`import ${JSON.stringify(new URL(t,"file:///home/user/workspace/hike/node_modules/maplibre-gl/dist/maplibre-gl.mjs").href)}`],{type:"text/javascript"}),URL.createObjectURL(r));try{return eh(a,i)}finally{URL.revokeO

**Why it happens:** The MapLibre package embeds a file URL in the browser
chunk. It is not a source map; the existing output contains no `*.map` files.

**Suggested fix:** Upgrade/configure MapLibre so its browser distribution does
not embed a local worker path, or apply a build-time replacement verified
against the production bundle. Treat this as defense-in-depth rather than a
route-safety defect.

**Confidence:** **High.** The exact shipped string was extracted from the
existing `.next/static` output without rebuilding.

## Held up under attack

- `npm audit --omit=dev --json` returned **0 production vulnerabilities**.
  The full audit’s four moderate findings are the dev-only
  `drizzle-kit -> @esbuild-kit -> esbuild` chain; the advisory describes a
  development-server issue. `tsx` is declared in `devDependencies`, and
  `package-lock.json` v3 covers 1,118 packages with **0** packages missing an
  integrity field. All 1,111 resolved packages use `registry.npmjs.org`.
- The package manifest uses many caret/floating semver ranges, but the
  committed lockfile pins the actual install. `.gitignore` excludes `.next`,
  `.env*` (apart from `.env.example`), `data`, and generated SW maps. Git
  tracks no `.env` secret and no `.next` artifact; `public/sw.js` is the one
  tracked generated build artifact.
- No actual API key value was found in client output. The only client public
  configuration reference is `NEXT_PUBLIC_MAPTILER_KEY`, which is expected to
  be public for browser map tiles; `OPENAI_API_KEY`, `TAVILY_API_KEY`,
  `NPS_API_KEY`, and `RIDB_API_KEY` were absent. No production source maps
  were present.
- Document, API, and static-asset responses each carried CSP,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy`,
  `Permissions-Policy`, and the complete `object-src 'none'`, `base-uri
  'self'`, `form-action 'self'`, and `frame-ancestors 'none'` directives.
  The CSP does contain `'unsafe-inline'` for script and style, but no
  `'unsafe-eval'`; this is a residual XSS mitigation weakness rather than a
  standalone exploit found here. The running local response did not contain
  HSTS; because this server is HTTP and a TLS/CDN terminator was unavailable,
  external HTTPS/HSTS behavior is **UNVERIFIED**.
- Owner API cache protection held: an authenticated `GET /api/plans` returned
  `Cache-Control: no-store`; the same was true for cookie-less owner API
  responses.
- The manifest is valid JSON, names `/` as `start_url`, and both declared
  icons returned `200 image/png`. `/offline` is explicitly precached and says
  the navigation screen was not saved, so it does not falsely claim a route
  is available. `/` itself was not listed in the generated precache manifest:
  an offline installed-app launch therefore falls back safely to `/offline`
  rather than loading a stale start page.
- Service-worker scope is same-origin. Serwist’s default policy can cache
  cross-origin GET assets, but the app has no user-controlled outbound URL and
  cache keys remain origin-specific, so I did not demonstrate a third-party
  response being served as same-origin app content. The custom navigation
  cache’s `ignoreSearch`/`ignoreVary` behavior is part of the already-known
  cached-shell-poisoning issue and is intentionally not re-reported.
- OSM tag text reaches React text nodes and can reach the LLM research
  context, but the existing `adversarial/xss-probe.test.ts` covers the
  relevant URL-sink and prompt-injection limitations. It passes, so I did not
  duplicate that already-covered finding.
