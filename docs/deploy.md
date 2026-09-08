# Deploying Klandagi (Vercel + Neon)

The app has one server deployment (web PWA + API) and, later, an iOS shell that
talks to the same API over HTTPS with a bearer token.

> **Launching on Replit instead?** See `docs/deploy-replit.md`. It needs one
> signup rather than two (Replit provides the database), and the app itself is
> not host-specific — moving between the two is a matter of changing one URL.
> The one thing that genuinely differs: Replit does not report deployments to
> GitHub, so the smoke workflow has to be triggered manually with the URL.

## One-time setup (yours — ~15 minutes of dashboards)

1. **Neon** (https://neon.tech): create a project (pick the region nearest your
   Vercel region, e.g. US East). Copy the connection string.
   - Optional but recommended: create a second branch named `preview` for
     Vercel preview deployments, so previews never touch real data.
2. **Vercel** (https://vercel.com): "Add New Project" → import the
   `CatCorner22/hike` GitHub repo. Framework: Next.js. Node 20. Leave the build
   command default (`npm run build`).
3. In Vercel → Project → Settings → Environment Variables, set:

   | Variable | Production value | Preview value | Notes |
   |---|---|---|---|
   | `DATABASE_URL` | Neon main branch string | Neon `preview` branch string | **REQUIRED in production.** The JSON-file fallback is dev-only: `isLocalStoreEnabled()` refuses it when `NODE_ENV=production`, so without a database every user-data route answers 503 and the smoke check fails. (`ALLOW_LOCAL_STORE_IN_PRODUCTION=true` exists as a single-node escape hatch; do not use it on Vercel — serverless instances don't share a filesystem.) |
   | `SESSION_SECRET` | 32+ random bytes (`openssl rand -base64 32`) | a DIFFERENT random value | REQUIRED in production; rotating it logs every device out (each mints a fresh identity and old rows become unreachable) |
   | `TRUST_PROXY_HEADERS` | `true` | `true` | Vercel overwrites X-Forwarded-For, so this is safe AND necessary — without it the rate limiter lumps every caller into one bucket |
   | `ALLOWED_APP_ORIGINS` | *(empty)* | *(empty)* | `capacitor://localhost` + `https://localhost` are built in; add extras here only if needed |
   | `NPS_API_KEY`, `RIDB_API_KEY`, `OPENAI_API_KEY`, `AI_GATEWAY_API_KEY`, `TAVILY_API_KEY`, `NEXT_PUBLIC_MAPTILER_KEY` | as available | optional | every one degrades gracefully when absent. Pioneer opens from either AI key; `PIONEER_ENABLED=0` or `PIONEER_KILL=1` closes only the model door. |

4. **Schema push** (from any machine with the repo):
   `DATABASE_URL='<neon string>' npx drizzle-kit push`
   (This repo's `drizzle/` folder has no migration journal, so `push` — which
   diffs the schema directly — is the supported path. If you start evolving the
   schema regularly, run `drizzle-kit generate` once to start a journal.)
5. Deploy (Vercel deploys on push to `main`).

## What verifies it

`.github/workflows/deploy-smoke.yml` runs automatically on every successful
production deployment and checks: public search works, `POST /api/session`
mints a token, a bearer-authed request succeeds, CORS answers the iOS shell's
origin, and the paid research route still refuses anonymous callers. If that
workflow is red, the deployment is not usable by the phone app — treat it as a
failed deploy.

## Known limits (stated plainly)

- The rate limiter is per-serverless-instance. Fine at personal scale; move to
  a shared store (e.g. Upstash Redis) before any public launch.
- Identity is per-device (signed anonymous token). Clearing site data or
  deleting the app orphans that identity's server rows — route packs already
  on the device keep working regardless.
