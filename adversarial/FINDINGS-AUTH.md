# Auth, session and tenancy — adversarial findings

The agent assigned this domain built `adversarial/probe-auth-live.mjs` but never
produced a report. This file was written by re-running its probe directly and
verifying each result, so nothing here is taken on trust.

## Summary

1 MEDIUM, 1 HIGH (the HIGH is recorded in `FINDINGS-SUPPLY.md` F-01 and fixed in
`src/proxy.ts`). **The ownership model itself held up well** — this is the
strongest surface in the app.

Probe output, `BASE=http://127.0.0.1:3111 node adversarial/probe-auth-live.mjs`:

    PASS mint and create :: A=200 B=200
    PASS forged owner :: HTTP 401
    PASS truncated signature :: HTTP 401
    PASS signature reuse :: HTTP 401
    FAIL malformed percent cookie no 5xx :: HTTP 500
    PASS plan IDOR denied :: GET=404 PATCH=404 DELETE=404
    PASS activity and point IDOR denied :: own=200 detail=404 points=404 post=404
    PASS per-owner API cache protection :: Cache-Control=no-store
    PASS duplicate cookie selects first session :: POST=200 attacker=true victim=false

## F-01 A malformed cookie returns 500 instead of failing closed — MEDIUM

**Hiker consequence:** A cookie mangled in transit or by another app on the
device turns every API call into a server error rather than a clean
re-authentication, so the app appears broken with no route to recovery.

**Where:** `src/lib/auth/owner.ts:116` (`readCookie`)

**Reproduction:**

    curl -s -o /dev/null -w "%{http_code}\n" \
      "http://127.0.0.1:3111/api/plans" -H 'cookie: hike_owner=%E0%A4%A'
    500

**Why it happens:** `decodeURIComponent` throws on an invalid percent escape and
nothing caught it, so the throw propagated as an unhandled error.

**Fix applied:** `readCookie` now returns `null` for an undecodable value. An
unreadable cookie is simply not a session, so the caller answers 401 and the
client can mint a new one. Regression test in `src/lib/auth/owner.test.ts`.

**Confidence:** High — reproduced directly, and the 500 disappears with the fix.

## F-02 A session-establishing response was cacheable — HIGH (see FINDINGS-SUPPLY F-01)

Recorded in full in `FINDINGS-SUPPLY.md`. Summarised here because it is the only
finding on this surface that could cross the tenancy boundary: `/plan` returned
`Set-Cookie: hike_owner=...` together with `Cache-Control: s-maxage=31536000` and
no `private`/`no-store`, so a shared cache could replay one hiker's owner
credential to every later visitor and hand them that hiker's plans and tracks.

Verified before the fix:

    curl -sD - -o /dev/null http://127.0.0.1:3111/plan \
      -H 'accept: text/html' -H 'sec-fetch-dest: document' | grep -iE '^(set-cookie|cache-control)'
    set-cookie: hike_owner=1a87d1e4-...; Path=/; Max-Age=31536000; Secure; HttpOnly; SameSite=lax
    cache-control: s-maxage=31536000

Fixed in `src/proxy.ts`: a minting response is now `private, no-store, max-age=0`,
and all proxy-matched responses carry `Vary: Cookie` so an upstream cache cannot
serve one owner's page to another. Tests in `src/proxy.test.ts`.

## Held up under attack

These were attacked and behaved correctly. Worth recording so the next round does
not re-tread them:

- **Token forgery.** A fabricated `<ownerId>.<signature>`, a truncated HMAC, and a
  signature lifted from one ownerId and attached to another are all rejected with
  401.
- **IDOR.** Cross-owner reads and writes of plans, activities and points all
  return 404 rather than 403, so they do not even confirm the id exists.
- **API cache isolation.** Per-owner API responses carry `Cache-Control: no-store`
  (set in `next.config.ts` for `/api/:path*`).
- **Duplicate cookie header.** Sending two `hike_owner` cookies resolves to the
  first and does not let an attacker-supplied second value take over the session.
- **Cookie attributes.** `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`.
- **Cookie-less API calls** get 401; sessions mint only on document navigations,
  so a script cannot mint owners through the API.
- **Constant-time signature comparison.** `timingSafeEqual` in
  `src/lib/auth/owner.ts:69` accumulates XOR differences over the full string
  rather than returning early, so it does not leak the signature byte by byte.
  It compares length first, which reveals only the digest length -- a constant.

## Not tested

- **Real CDN/TLS replay** of the cacheable session response. The local target is
  plain HTTP with no shared cache in front, so the leak was demonstrated from the
  response headers rather than by observing an actual cross-user replay.
- **HSTS**, for the same reason.
- **Multi-instance rate limiting.** The limiter is explicitly process-local; see
  `src/lib/api/rate-limit.ts`, where the bypass and unbounded-growth defects
  found in this round are documented and fixed.
