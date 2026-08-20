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
| [FINDINGS-api.md](FINDINGS-api.md) | 1 critical, 2 high, 3 medium, 3 low | Unauthenticated read/write/delete of any plan or GPS track by UUID |

## Regression tests

These run as part of the normal suite (`npx vitest run`), because every one of
them is a bug that already happened once:

- `geo-time.test.ts` — antimeridian, poles, polar day/night, DST gaps, clock skew, degenerate geometry
- `safety-modules.test.ts` — input abuse, cross-module contradictions, severity monotonicity, report injection
- `verify-fixes.test.ts` — direct assertions that each critical fix holds
- `xss-probe.test.ts` — URL sinks and the LLM prompt-injection surface
- `api-owner-store.test.ts` — device-scoped ownership isolation

## Probes (run manually)

Need a production server, because the service worker is disabled in dev:

```bash
npm run build
OWNER_TOKEN_SECRET="$(openssl rand -base64 32)" \
  ALLOW_LOCAL_STORE_IN_PRODUCTION=true \
  npx next start --port 3111 &
```

| Probe | What it does |
| --- | --- |
| `node adversarial/api-probe.mjs` | Fuzzing, injection, size limits, IDOR, response hygiene |
| `node adversarial/offline-adversarial.mjs` | Corrupt IndexedDB, alias attacks, cache poisoning, quota, clock skew |
| `node adversarial/gps-adversarial.mjs` | Teleports, frozen fixes, null island, antimeridian positions |
| `node adversarial/retest-concurrency.mjs` | 50 parallel writes; must retain 50/50 |
| `node adversarial/csp-check.mjs` | Confirms the CSP does not break the map |
| `npx vitest run adversarial/perf.bench.ts` | Scale benchmarks; writes `perf-results.json` |

## Performance baselines

Regressions here are safety issues: `progressAlongTrail` runs on every GPS fix,
and a 25-second stitch hangs the server.

| Operation | Before | After |
| --- | --- | --- |
| `relationToLineString`, 5k ways | 24,700 ms | 40 ms |
| `progressAlongTrail`, 100k pts (per fix) | 477 ms | 0.2 ms steady |
| GPX persisted per 100k-pt pack | 6.79 MB | 0 B |
| Local store write at 50k points | 727 ms | 0.33 ms |
| `/navigate` client JS (gzip) | 148,744 B | 111,429 B |

## A note on one assertion

`navigator.storage.persist()` cannot be granted in headless Chromium — the
permission stays at `prompt` and it resolves `false` even after a CDP
`durableStorage` grant. So the offline e2e asserts that the app *requests*
durability and *reports refusal honestly*, rather than asserting the browser
grants it. Testing the browser would prove nothing about the app.
