# Adversarial test suite

Hostile-input testing for a tool people depend on in the backcountry. The
governing principle throughout: **fail safe, never fail confident.** A plausible
wrong answer is worse than a refusal, because a hiker will act on it.

## Findings

Four assessments, 40 confirmed findings, all fixed:

| Report | Findings | Worst |
| --- | --- | --- |
| [FINDINGS-geo-time.md](FINDINGS-geo-time.md) | 1 critical, 4 high, 3 medium | A dateline route produced a 359.8°-wide bbox, so a fix 20,000 km away read as on-route and **suppressed the off-route warning** |
| [FINDINGS-safety.md](FINDINGS-safety.md) | 2 critical, 5 high, 5 medium, 1 low | Severe altitude illness said "DESCEND NOW" while CASEVAC said "stay put" for the same casualty |
| [FINDINGS-offline-perf.md](FINDINGS-offline-perf.md) | 1 critical, 4 high, 6 medium | A corrupted alias pointer made `/navigate/<id>` load **someone else's route** |
| [FINDINGS-OFFLINE-NAV.md](FINDINGS-OFFLINE-NAV.md) | Consolidated | Full offline navigation adversarial pass — probes, fixes, remaining limits |
| [FINDINGS-STORAGE.md](FINDINGS-STORAGE.md) | 1 critical, 2 high, 1 medium | Evicted pack still claimed saved; JSON fallback overwrite |
| [FINDINGS-api.md](FINDINGS-api.md) | 1 critical, 2 high, 3 medium, 3 low | Unauthenticated read/write/delete of any plan or GPS track by UUID |

## Regression tests

These run as part of the normal suite (`npx vitest run`), because every one of
them is a bug that already happened once:

- `geo-time.test.ts` — antimeridian, poles, polar day/night, DST gaps, clock skew, degenerate geometry
- `safety-modules.test.ts` — input abuse, cross-module contradictions, severity monotonicity, report injection
- `verify-fixes.test.ts` — direct assertions that each critical fix holds
- `xss-probe.test.ts` — URL sinks and the LLM prompt-injection surface
- `api-owner-store.test.ts` — device-scoped ownership isolation

## Probes

Most probes need a production server because the service worker is disabled in dev. The
`offline-navigation` CI job runs the full wired set after `npm run build` and
`next start --port 3111` (see `.github/workflows/ci.yml`).

Reproduce locally:

```bash
npm run build
SESSION_SECRET="$(openssl rand -base64 32)" \
OWNER_TOKEN_SECRET="$(openssl rand -base64 32)" \
ALLOW_LOCAL_STORE_IN_PRODUCTION=true \
npx next start --port 3111 &
export BASE=http://127.0.0.1:3111
```

Restart the server after every rebuild — a stale `next start` on the same port serves the
previous build’s chunks and the service worker install will hang on 404 precache entries.

| Probe | CI | What it does |
| --- | --- | --- |
| `node e2e/offline-navigation.mjs` | yes | Cold/warm offline navigate, ownership, durable storage UX |
| `node adversarial/offline-adversarial.mjs` | yes | Corrupt IndexedDB, alias attacks, cache poisoning, quota, clock skew, stacked extra poison |
| `npx vitest run adversarial/probe-stacked-failures.test.ts` | unit job | Offline + poisoned extras + stale GPS + dateline + clock skew + invented exits |
| `node adversarial/gps-adversarial.mjs` | yes | Teleports, frozen fixes, null island, antimeridian positions |
| `node adversarial/probe-storage-browser.mjs` | yes | Eviction UI, schema errors, corrupt pack refusal |
| `node adversarial/probe-storage-local.mjs` | yes | JSON fallback corruption, point-queue limits |
| `node adversarial/probe-new-activity-pause.mjs` | yes | Pause/resume must not count movement while paused |
| `node adversarial/api-probe.mjs` | yes | Fuzzing, injection, size limits, IDOR, response hygiene |
| `node adversarial/retest-concurrency.mjs` | yes | 50 parallel writes; must retain 50/50 |
| `node adversarial/csp-check.mjs` | yes | Confirms the CSP does not break the map |
| `node adversarial/probe-storage-weather-stall.mjs` | manual | Pack save completes when weather fetch stalls |
| `npx vitest run adversarial/perf.bench.ts` | bench job | Scale benchmarks; writes `perf-results.json` |

## Performance baselines

Regressions here are safety issues: `progressAlongTrail` runs on every GPS fix,
and a 25-second stitch hangs the server.

Reproduce with `npm run bench`, which writes `adversarial/perf-results.json`.
Absolute numbers are machine-dependent; these are from a 2-vCPU Linux runner.

| Operation | Before | After |
| --- | --- | --- |
| `relationToLineString`, 5k disconnected ways | 24,700 ms | 41 ms |
| `progressAlongTrail`, 100k pts (per fix) | 494 ms | 0.15 ms steady |
| GPX persisted per 100k-pt pack | 6.79 MB | 0 B |
| `/navigate` client JS (gzip) | 148,744 B | 111,429 B |

### Correction: local store write

An earlier version of this table claimed the local store write at 50k points
went from 727 ms to **0.33 ms**. That was wrong, and `npm run bench` could not
have supported it because the script was misconfigured and silently ran nothing
(`vitest` reported "No test suite found" for a plain script, and exited before
executing it). Both are fixed: the bench now runs under `tsx`, and CI runs it.

Measured append latency, after caching the parsed store in memory and dropping
JSON indentation:

| Existing points | Before | After |
| --- | --- | --- |
| 0 | 0.91 ms | 1.32 ms |
| 10,000 | 21.8 ms | 16.4 ms |
| 50,000 | 105.2 ms | 100.6 ms |

The improvement is marginal because the cost is dominated by `JSON.stringify` of
the whole store plus the file write, which is inherently O(n) per mutation. This
path is the JSON fallback store, gated behind
`ALLOW_LOCAL_STORE_IN_PRODUCTION`; Postgres is the real write path and is not
affected. Treated as a documented limitation of the fallback rather than a
claimed fix.

## A note on one assertion

`navigator.storage.persist()` cannot be granted in headless Chromium — the
permission stays at `prompt` and it resolves `false` even after a CDP
`durableStorage` grant. So the offline e2e asserts that the app *requests*
durability and *reports refusal honestly*, rather than asserting the browser
grants it. Testing the browser would prove nothing about the app.
