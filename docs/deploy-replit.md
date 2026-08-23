# Launching Klandagi on Replit

The fastest path to a live URL, and the one that needs the fewest accounts:
Replit hosts the app and provides the database, so this is one signup instead of
two. `docs/deploy.md` covers the Vercel + Neon path if you move later — nothing
in the app is host-specific, and moving is a matter of changing one URL.

**Getting this live is now the thing that unblocks the App Store**, not just a
convenience. App Store Connect requires a Privacy Policy URL and will not accept
a build without one; the page ships in this app at `/privacy` and goes live the
moment the deployment does.

## What you do

1. **Import the repo.** Replit → Create → Import from GitHub →
   `CatCorner22/hike`. The committed `.replit` file already tells it how to
   build, run and deploy, so there is nothing to configure here.

2. **Add the database.** In the workspace, open the Database tool and create a
   PostgreSQL database. Replit sets `DATABASE_URL` in your Secrets
   automatically — confirm it is there before going further. Any Postgres works:
   Replit's own, Neon, or your own server.

   The app picks its client from the host. Anything that is not a Neon endpoint
   gets `pg`, which speaks the protocol every Postgres understands; a
   `*.neon.tech` host gets `@neondatabase/serverless`, which is faster on a
   serverless platform and is what the Vercel path in `docs/deploy.md` uses. The
   guess leans that way on purpose — choosing `pg` for Neon still works, while
   choosing the Neon HTTP driver for an ordinary Postgres fails outright, because
   it is not a Postgres client at all: it posts SQL to `https://<host>/sql`.

   If a host ever defeats the guess, set `DATABASE_DRIVER` to `postgres` or
   `neon-http` and it is settled. The server names its choice in the first log
   line it writes: `[db] using the postgres driver for …`.

3. **Push the schema**, once, from the Replit shell:

   ```
   npx drizzle-kit push
   ```

   This repo's `drizzle/` folder has no migration journal, so `push` — which
   diffs the schema directly — is the supported path.

4. **Set the secrets.** In the Secrets pane:

   | Secret | Value | Why |
   |---|---|---|
   | `SESSION_SECRET` | 32+ random bytes — run `openssl rand -base64 32` in the shell | **Required.** The server fails closed without it. Rotating it logs every device out: each mints a fresh identity and old rows become unreachable. |
   | `NPS_API_KEY`, `RIDB_API_KEY`, `OPENAI_API_KEY`, `TAVILY_API_KEY`, `NEXT_PUBLIC_MAPTILER_KEY` | as available | All optional. Every one degrades gracefully when absent — which also means a dead key is invisible, so re-check trail search after rotating one. |

   **Do not set `ALLOW_LOCAL_STORE_IN_PRODUCTION`.** It exists as a
   single-node development escape hatch and it will appear to work: the app
   falls back to a JSON file, serves happily, and then loses every plan and
   track the next time the container is replaced. Without a database the app
   answers 503 on user-data routes, which is the honest failure.

   `TRUST_PROXY_HEADERS` is deliberately **not** in that table. Leave it unset.
   It tells the rate limiter to believe `X-Forwarded-For`, which is only safe
   behind a proxy that overwrites the header. Unset, every caller shares one
   bucket: stricter than necessary, never weaker, and correct for a personal
   deployment. Set it only if you have confirmed Replit's edge overwrites that
   header and you have more than one user.

5. **Deploy.** Hit Deploy and take the defaults; `.replit` already declares
   Autoscale, the build command and the run command. Note the URL it gives you —
   something like `https://klandagi.replit.app`.

6. **Prove it actually works for the phone**, which is the part that matters:

   GitHub → Actions → **Deploy smoke** → Run workflow → paste the deployment
   URL. It mints its own session, so it needs no secrets. If it is red, the
   deployment is not usable by the iOS app — treat that as a failed deploy, not
   a flaky test. It checks the five things that have to hold:

   - public trail search answers
   - `POST /api/session` mints a bearer token — the shell's **only** auth path
   - a bearer-authed request succeeds
   - CORS echoes `capacitor://localhost` — without it the shell cannot call the
     API at all, however valid its token
   - the paid research route still refuses anonymous callers

   (On Vercel this fires automatically on every deploy. Replit does not report
   deployments to GitHub, so here it is the manual trigger.)

7. **Point the iOS build at it.** GitHub → repo Settings → Secrets and variables
   → Actions → Variables → New repository **variable**:

   ```
   NEXT_PUBLIC_API_BASE = https://<your-deployment>.replit.app
   ```

   This does two jobs: it is where the shell sends its API calls, and it is the
   origin the private Trip Guardian link is built from. Without it the shell
   would generate a `capacitor://localhost` link nobody else can open — the app
   now refuses to create one at all rather than hand you a dead link.

8. **Paste the privacy policy URL** into App Store Connect:
   `https://<your-deployment>.replit.app/privacy`. The honest-limits page at
   `/terms` is worth using as the support URL.

### Reading a red smoke check

The two mistakes that are easy to make fail at different assertions, so the
check tells you which one you made. Both were verified against a real build of
this app, not inferred:

| What the smoke check says | What is actually wrong |
|---|---|
| `session mint returned 503` | `SESSION_SECRET` is not set. The server refuses to establish any identity rather than silently giving everyone the same one. |
| session mint passes, then `bearer-authed plans returned 503` | `DATABASE_URL` is not set or the schema was never pushed. Identity works; there is nowhere to put data. |
| `CORS preflight did not echo capacitor://localhost` | The proxy is not running — usually the build did not produce it. The iOS shell cannot talk to this API at all in that state, however valid its token. |
| `unauthed research returned 200` | The paid OpenAI/Tavily route is open to anonymous callers. Stop and fix before leaving it up. |

Both 503s answer `{"error":"Server is not configured for user data"}` rather
than pretending to work, which is the behaviour you want: a deployment that
looks healthy and quietly loses hikes is worse than one that refuses.

## Things worth knowing before you rely on it

- **Autoscale sleeps.** After idle, the first request pays a cold start of a few
  seconds. That is fine for this app — the moment that matters is downloading a
  route pack at the trailhead, and everything after that is offline — but it is
  not fine if you ever put a status page in front of people. Switch
  `deploymentTarget` to `reserved-vm` in `.replit` for an always-on instance.
- **The rate limiter is per-instance and in-memory.** Under Autoscale that means
  per running container, and it resets when one is replaced. At personal scale
  this is fine; it exists mainly to stop the outbound Overpass and elevation
  calls being exhausted, because when those get you banned upstream, nobody can
  download a route. Before any public launch, move it to a shared store.
- **The filesystem is not storage.** Anything written to disk is gone when the
  container is replaced. The database is the only durable thing here — which is
  why `ALLOW_LOCAL_STORE_IN_PRODUCTION` is a trap rather than a shortcut.
- **The service worker is built once, not per instance.** `public/sw.js` and its
  precache revisions are generated during `npm run build`, so every container
  serves the same one. Multiple instances cannot disagree about what a client
  should have cached.

## If the build dies without an error

`next build` on a small container can exhaust the Node heap, and the failure
often reads as an unexplained kill rather than an out-of-memory message.
`.replit` already sets `NODE_OPTIONS=--max-old-space-size=4096`; raise it, or
move to a larger machine, if it recurs.
