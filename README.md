# Klandagi

**Know the route. Know the risks. Know how you're getting home.**

*Klandagi* (Cherokee: mountain lion) is a safety-first wilderness decision-support app for exploring OSM trails, preparing an offline route pack, navigating when tiles and networks disappear, recording an activity, and communicating an honest rescue position.

The product roadmap is in [`docs/product-roadmap.md`](docs/product-roadmap.md). The strategic direction is contingency navigation rather than a generic trail-review social network.

## What actually works

- **Explore** — OpenStreetMap hiking routes, elevation, difficulty tags
- **Plan** — Dates, notes, GPX import, camping stops, and named waypoints
- **GPX interoperability** — Validated route and activity geometry can be exported as GPX; new offline packs do not retain a duplicate GPX payload
- **Prepare offline** — Saves a route pack to IndexedDB `hike-nav-packs`
- **Navigate** — Self-contained canvas Safety Map. Works with no network and no map tiles once a pack is on the device. Off-trail: warn at **35 m**, critical at **80 m** (adjusted for GPS accuracy)
- **SOS / ICE** — One `navFix` (live GPS, last-known, or pace/heading dead reckon) for SMS, dossier, and “walk this bearing”
- **Activities** — Start/stop/pause work offline. Pause stops GPS. Points queue in IndexedDB and replay when you are back online
- **Camping** — NPS / RIDB / state parks / OSM. Search does **not** auto-sync the world on an empty result; pass `?sync=true` to refresh
- **Weather snapshot** — Pack-time conditions are cached with explicit freshness semantics; cached weather is never presented as live weather
- **Route forecast briefing** — Prepare stores an along-route Open-Meteo snapshot (heat/cold/wind/precip/thunderstorm thresholds plus sunrise/sunset). It expires after 6 hours and is never shown as current weather. Smoke, AQI, and land-manager alerts are not included
- **Decision-support primitives** — deterministic daylight/ETA margin, ordered decision points/bailouts, and an overdue Trip Guardian state that never equates a missing update with proof of distress
- **Research** — Optional AI brief. Reservation and source links are **https only**

## Safety architecture

Safety calculations stay deterministic and testable. AI may summarize retrieved facts, but it must not calculate coordinates, bearings, rescue instructions, or emergency thresholds. Missing, stale, cached, and inferred information must remain visibly distinguishable.

The existing route-only canvas remains the guaranteed **Safety Map** even as richer offline terrain is added later. A commercial map layer must never become a single point of failure for prepared navigation.

## What it is not

This is land-nav / SAR / wilderness support — not weapons or targeting. It is not a substitute for a paper map, compass, redundant lighting/power, or official park guidance.

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
| `SESSION_SECRET` | **Yes in production** | Signs the anonymous device-owner cookie that scopes plans, activities and GPS tracks. Generate with `openssl rand -base64 32`. Without it the server refuses user data rather than serving location history unscoped. (`OWNER_TOKEN_SECRET` is accepted as a legacy alias.) |
| `NPS_API_KEY` | For NPS camping/research | developer.nps.gov |
| `RIDB_API_KEY` | For federal camping | ridb.recreation.gov/profile |
| `OPENAI_API_KEY` | For AI research | Optional |
| `TAVILY_API_KEY` | For web research | Optional |
| `NEXT_PUBLIC_MAPTILER_KEY` | Optional | MapTiler outdoor tiles (defaults to OpenFreeMap) |

### Database (optional)

```bash
npm run db:push
# or
psql $DATABASE_URL -f drizzle/0000_init.sql
psql $DATABASE_URL -f drizzle/0001_campground_external_unique.sql
psql $DATABASE_URL -f drizzle/0001_trails_osm_type_unique.sql
psql $DATABASE_URL -f drizzle/0002_owner_scoping.sql
psql $DATABASE_URL -f drizzle/0003_activity_point_idempotency.sql
```

`campgrounds.external_id` is unique. Upserts use that key.

### Run

```bash
npm run dev          # no service worker
npm test
npm run build        # webpack + Serwist
npm start            # PWA / offline shell
```

Open `http://localhost:3000`.

## Deploy to Vercel

1. Push to GitHub and import the repo in Vercel
2. Add environment variables from `.env.example`
3. Connect a Neon Postgres database and set `DATABASE_URL`
4. Set `OWNER_TOKEN_SECRET` / `SESSION_SECRET` before production
5. Deploy — the app builds with webpack for Serwist PWA support

## Who can see your data

Plans and activities are scoped to an owner. Every API route resolves the caller from an HttpOnly, HMAC-signed `hike_owner` cookie and constrains its queries to that owner. A row belonging to someone else answers `404`, not `403`, because a `403` would confirm the id exists.

This is currently **device identity, not a login**. Clearing cookies or switching browsers produces a new owner. Downloaded route packs remain local and continue working. Optional accounts and multi-device sync are a roadmap item; they must never become prerequisites for prepared offline navigation.

Set `SESSION_SECRET` before deploying and treat rotation as a migration event: rotating it invalidates existing owner cookies and can orphan access to server-stored rows unless a re-claim path is provided.

## Offline navigation (life-safety)

Before leaving coverage:

1. Open the trail or plan on Wi-Fi.
2. Tap **Prepare offline** to write the route pack.
3. Install/test the PWA from a production build (`build && start`), not `npm run dev`.
4. Verify offline readiness at the trailhead.
5. Open **Navigate**. The route remains visible without tiles or network.
6. Keep redundant power, lighting, map/compass skills, and official guidance appropriate to the trip.

If Navigate opens with no usable pack and no network, it fails clearly. A stale GPS fix is display-only. SOS and the map use the same position source. Off-trail warnings begin at 35 m and escalate at 80 m after accounting for GPS accuracy.

## Project structure

```text
src/
├── app/              # Pages and API routes
├── components/       # UI, map, trails, activities, camping
└── lib/
    ├── db/           # Drizzle schema (optional Postgres)
    ├── store/        # File-store fallback when DATABASE_URL is unset
    ├── osm/          # Overpass trail queries
    ├── geo/          # Segment-safe distance, GPX, elevation
    ├── offline/      # Route packs, safety brief, activity queue
    └── safety/       # Land-nav, SOS, ICE, GPS quality, decision support
```

## Data sources

- Trails: OpenStreetMap via Overpass (`route=hiking`)
- Elevation: Open-Elevation
- Camping: NPS, Recreation.gov RIDB, CA/CO/WA open data, OSM camp sites
- Research: NPS + Tavily + OpenAI when keys are set

## License

MIT
