# Hike

A bespoke hiking app for planning hikes, tracking activities, real-time trail navigation, AI-consolidated trail research, and discovering tent and backcountry camping at state and national parks.

## Features

- **Explore trails** — Search OpenStreetMap hiking routes with map, elevation profiles, and difficulty tags
- **Plan hikes** — Create trip plans with dates, notes, GPX import/export, and camping stops
- **Track activities** — Record GPS tracks with distance, elevation gain, pace, and duration
- **Navigate live** — Full-screen map navigation with off-trail alerts and elevation progress
- **Trail research** — AI-synthesized briefs from NPS data and web sources (season, hazards, parking, crowds)
- **Camping** — Tent, RV, backcountry, and walk-in sites from NPS, Recreation.gov RIDB, and state park open data (CA, CO, WA)
- **Offline** — PWA with service worker; cache trails and plans in IndexedDB for backcountry use

## Tech stack

- Next.js 16 (App Router) + TypeScript
- MapLibre GL JS + react-map-gl
- Drizzle ORM + Neon Postgres
- Vercel AI SDK + Tavily (trail research)
- Serwist (PWA service worker)
- Turf.js (geospatial)
- shadcn/ui + Tailwind CSS

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env.local` and fill in values:

```bash
cp .env.example .env.local
```

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes* | Neon Postgres connection string |
| `SESSION_SECRET` | **Yes in production** | Signs the anonymous device-owner cookie that scopes plans, activities and GPS tracks. Generate with `openssl rand -base64 32`. Without it the server refuses user data rather than serving location history unscoped. (`OWNER_TOKEN_SECRET` is accepted as a legacy alias.) |
| `NPS_API_KEY` | For NPS camping/research | [developer.nps.gov](https://developer.nps.gov/) |
| `RIDB_API_KEY` | For federal camping | [ridb.recreation.gov/profile](https://ridb.recreation.gov/profile) |
| `OPENAI_API_KEY` | For AI research | OpenAI or compatible provider |
| `TAVILY_API_KEY` | For web research | [tavily.com](https://tavily.com/) |
| `NEXT_PUBLIC_MAPTILER_KEY` | Optional | MapTiler outdoor tiles (defaults to OpenFreeMap) |

\*Plans, activities, and cached data require Postgres. Trail search and maps work without a database.

### 3. Set up the database

```bash
# Push schema to Neon
npm run db:push

# Or run the SQL migration manually
psql $DATABASE_URL -f drizzle/0000_init.sql
```

### 4. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 5. Build for production

```bash
npm run build
npm start
```

## Deploy to Vercel

1. Push to GitHub and import the repo in Vercel
2. Add environment variables from `.env.example`
3. Connect a [Neon Postgres](https://neon.tech) database and set `DATABASE_URL`
4. Deploy — the app builds with webpack for Serwist PWA support

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

## How to use it

The app ships its own hiker-facing guide at **`/guide`** (linked from the home screen):
plan → **Prepare offline** while you still have signal → Navigate at the trailhead →
what to do when something goes wrong. If you read nothing else, read that page's rule:
save the route before you lose coverage.

## Offline navigation (life-safety)

Navigation is designed to keep working after cell service drops. Do this **before** you leave coverage:

1. Open the trail or plan while you still have service. The app auto-saves a **route pack** (geometry, elevation, GPX) to IndexedDB on this device.
2. Tap **Prepare offline** if you want to confirm or refresh the pack.
3. Install the PWA (Add to Home Screen) so the navigate shell is cached.
4. Open **Navigate**. The screen uses a self-contained trail map that does **not** need map tiles or the network.
5. Keep the phone charged. The navigate screen requests a wake lock so it stays visible.

If you open Navigate with no pack and no network, you will see a clear error: download the route first. GPS loss does not close the map — the last fix is held and marked stale. Off-trail warnings start at 35 m from the route and escalate at 80 m, after allowing for half the reported GPS accuracy; they show the bearing back to the route.

This is a navigation aid, not a substitute for a paper map, compass, or official park guidance.

## Project structure

```
src/
├── app/              # Pages and API routes
├── components/       # UI, map, trails, activities, camping
└── lib/
    ├── db/           # Drizzle schema and connection
    ├── osm/          # Overpass API trail queries
    ├── nps/          # National Park Service API
    ├── ridb/         # Recreation.gov RIDB API
    ├── state-parks/  # CA, CO, WA GeoJSON ingest
    ├── geo/          # Turf helpers, GPX, elevation
    ├── research/     # AI trail research pipeline
    └── offline/      # IndexedDB helpers
```

## Data sources

- **Trails:** OpenStreetMap via Overpass API (`route=hiking`)
- **Elevation:** Open-Elevation API
- **National park camping:** NPS Data API
- **Federal recreation:** Recreation.gov RIDB (facilities, permit entrances)
- **State parks:** California CNRA, Colorado, Washington open GeoJSON/ArcGIS
- **Backcountry camps:** OSM `tourism=camp_site` nodes
- **Research:** NPS articles/alerts + Tavily web search + OpenAI synthesis

## License

MIT
