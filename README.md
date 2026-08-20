# Hike

A hiking app for exploring OSM trails, preparing an offline route pack, navigating without tiles, recording an activity, and sending an honest SOS grid.

## What actually works

- **Explore** — OpenStreetMap hiking routes, elevation, difficulty tags
- **Plan** — Dates, notes, GPX import, camping stops, and named waypoints
- **Prepare offline** — Saves a route pack to IndexedDB `hike-nav-packs` (not the unused `hike-offline` trail/plan stores)
- **Navigate** — Self-contained canvas map. Works with no network and no map tiles once a pack is on the device. Off-trail: warn at **35 m**, critical at **80 m** (adjusted for GPS accuracy)
- **SOS / ICE** — One `navFix` (live GPS, last-known, or pace/heading dead reckon) for SMS, dossier, and “walk this bearing”
- **Activities** — Start/stop/pause work offline. Pause stops GPS. Points queue in IndexedDB and replay when you are back online
- **Camping** — NPS / RIDB / state parks / OSM. Search does **not** auto-sync the world on an empty result; pass `?sync=true` to refresh
- **Research** — Optional AI brief. Reservation and source links are **https only**

## What it is not

This is land-nav / SAR / wilderness support — not weapons or targeting. It is not a substitute for a paper map, compass, or official park guidance.

## Tech stack

- Next.js 16 (App Router) + TypeScript
- MapLibre GL JS + react-map-gl (online maps); canvas HUD when navigating offline
- Drizzle ORM + Neon Postgres **optional** — plans and activities fall back to `data/store.json`
- Vercel AI SDK + Tavily (optional research)
- Serwist PWA — **off in `npm run dev`**. Use `npm run build && npm start` to exercise the service worker
- Turf.js, shadcn/ui, Tailwind CSS

## Getting started

```bash
npm install
cp .env.example .env.local
```

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | No | Neon Postgres. Without it, plans/activities use the local JSON file store |
| `LOCAL_STORE_PATH` | No | Override path for the file store (default `data/store.json`) |
| `OWNER_TOKEN_SECRET` | **Yes in production** | Signs the anonymous device-owner cookie that scopes plans, activities and GPS tracks to a device. Generate with `openssl rand -base64 32`. The server refuses to start without it in production rather than serve location history unscoped. |
| `SESSION_SECRET` | Yes, in production | Signs the owner cookie that scopes plans and activities. Without it the API refuses user data rather than sharing it |
| `NPS_API_KEY` | For NPS camping/research | [developer.nps.gov](https://developer.nps.gov/) |
| `RIDB_API_KEY` | For federal camping | [ridb.recreation.gov/profile](https://ridb.recreation.gov/profile) |
| `OPENAI_API_KEY` | For AI research | Optional |
| `TAVILY_API_KEY` | For web research | Optional |
| `NEXT_PUBLIC_MAPTILER_KEY` | Optional | MapTiler outdoor tiles (defaults to OpenFreeMap) |

### Database (optional)

```bash
npm run db:push
# or
psql $DATABASE_URL -f drizzle/0000_init.sql
psql $DATABASE_URL -f drizzle/0001_campground_external_unique.sql
psql $DATABASE_URL -f drizzle/0002_owner_scoping.sql
```

`campgrounds.external_id` is unique. Upserts use that key.

### Run

```bash
npm run dev          # no service worker
npm test
npm run build        # webpack + Serwist
npm start            # PWA / offline shell
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy to Vercel

1. Push to GitHub and import the repo in Vercel
2. Add environment variables from `.env.example`
3. Connect a [Neon Postgres](https://neon.tech) database and set `DATABASE_URL`
4. Set `OWNER_TOKEN_SECRET` / `SESSION_SECRET` before production
5. Deploy — the app builds with webpack for Serwist PWA support

## API keys

### NPS Data API
1. Register at [developer.nps.gov](https://developer.nps.gov/)
2. Create an API key
3. Set `NPS_API_KEY`

### Recreation.gov RIDB
1. Sign up at [ridb.recreation.gov/profile](https://ridb.recreation.gov/profile)
2. Generate an API key
3. Set `RIDB_API_KEY`

### AI trail research
- Set `OPENAI_API_KEY` for GPT-4o-mini synthesis
- Set `TAVILY_API_KEY` for web search consolidation
- Without these keys, research falls back to OSM tag data

## Who can see your data

Plans and activities are scoped to an owner. Every API route resolves the caller from an
HttpOnly, HMAC-signed `hike_owner` cookie and constrains its queries to that owner, so
one deployment can carry several people's data without any of them seeing the others'
routes, notes, or GPS traces. A row belonging to someone else answers `404`, not `403` —
a `403` would confirm the id exists.

Two things to be clear about:

- **This is not a login.** Identity is one browser on one device. Clearing cookies or
  switching browsers produces a new owner, and the previous rows become unreachable
  through the API. Downloaded route packs live in IndexedDB and keep working regardless,
  so this cannot strand you mid-trip — but it is not multi-device sync. Swapping in a
  real identity provider means changing `resolveOwnerId` in `src/lib/auth/owner.ts` and
  nothing else.
- **Set `SESSION_SECRET` before deploying, and then leave it alone.** In production a
  missing secret makes the user-data routes return `503` instead of silently degrading to
  one shared identity. Rotating it invalidates every existing cookie, which gives every
  user a new owner id and makes their stored plans and activities unreachable — treat it
  as permanent, or plan a re-claim (see the migration file) alongside the rotation.

Rows created before owner scoping have no owner and are hidden. `drizzle/0002_owner_scoping.sql`
explains how to claim them.

## Offline navigation (life-safety)

Do this **before** you leave coverage:

1. Open the trail or plan on Wi‑Fi. The app writes a **route pack** to `hike-nav-packs`.
2. Tap **Prepare offline** to confirm or refresh.
3. Install the PWA from a production build (`build && start`), not from `npm run dev`.
4. Open **Navigate**. The trail line stays up with no tiles and no network.
5. Keep the phone charged. Wake lock is requested; self-check reports whether it is actually held.

If you open Navigate with no pack and no network, you get a clear error. A stale GPS fix is display-only. SOS and the map use the same point and source. Off-trail warnings start at 35 m from the route and escalate at 80 m, after allowing for half the reported GPS accuracy; they show the bearing back to the route.

This is a navigation aid, not a substitute for a paper map, compass, or official park guidance.

## Project structure

```
src/
├── app/              # Pages and API routes
├── components/       # UI, map, trails, activities, camping
└── lib/
    ├── db/           # Drizzle schema (optional Postgres)
    ├── store/        # File-store fallback when DATABASE_URL is unset
    ├── osm/          # Overpass trail queries
    ├── geo/          # Segment-safe distance, GPX, elevation
    ├── offline/      # Route packs (hike-nav-packs) + activity queue
    └── safety/       # Land-nav, SOS, ICE, GPS quality
```

## Data sources

- Trails: OpenStreetMap via Overpass (`route=hiking`)
- Elevation: Open-Elevation
- Camping: NPS, Recreation.gov RIDB, CA/CO/WA open data, OSM camp sites
- Research: NPS + Tavily + OpenAI when keys are set

## License

MIT
