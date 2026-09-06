# movie-showtime-aggregator

A React-based movie-going decision workstation built around two tightly synchronized views:

- an Excel-style screening table where every displayed column can be sorted or filtered from its header;
- a poster-first **Movie Selection** page where the whole poster tile acts as the checkbox for the table's Movie filter.

The app discovers theaters around a configured ZIP code and radius, applies user-known preview times, and can optionally enrich screenings with movie ratings/posters, rough home travel times, and official AMC pricing/seating data. The Python backend remains authoritative for screening data, provider semantics, calculations, and enrichment; the React frontend consumes typed API contracts and performs only already-loaded interaction such as table sorting/filtering.

> **Fresh from the template?** Work through
> [docs/new-repo-checklist.md](docs/new-repo-checklist.md) first. It covers the
> handful of things GitHub does not copy when you click *Use this template*.

## Screening table

Click a column name to sort it. Click the dropdown at the right side of any column header to filter that column. Every column supports exact-value checkboxes. Text columns add contains/equals-style rules, time columns add before/after rules, and numeric columns add less-than/greater-than rules.

Current first-class columns include movie, IMDb, Rotten Tomatoes, Metacritic, theater, distance, seats left, ticket price, chain, listed start, actual start, leave-home time, end, back-home time, and format.

Known external values are source links:

- movie title → Letterboxd;
- IMDb → IMDb;
- Rotten Tomatoes → Rotten Tomatoes;
- Metacritic → Metacritic;
- AMC ticket price / seat availability → the matched AMC performance;
- leave-home / back-home → the OpenStreetMap/OSRM route;
- Fandango-derived screening fields → the screening's Fandango purchase/listing link.

`Unknown` stays plain text rather than linking to an invented source.

**Distance** is straight-line distance from the configured ZIP center to the theater. It is not driving distance.

**Saved views** store table filter/sort state in that browser's local storage, but deliberately exclude the exact Movie Selection. Loading a Saved View preserves whichever movies are currently selected; older saved views are migrated to remove stored movie selections. Settings are also deliberately separate from Saved Views.

## Movie Selection

Open `/movies` or use **Movies** in the application navigation. The page is a dark, poster-first grid inspired by a theater-app Now Playing screen. The poster itself is the selection control; selecting or deselecting a movie immediately updates the browser-persistent Movie filter used by the screening table.

Movie Selection has local filters for title, selected/unselected status, minimum IMDb/Rotten Tomatoes/Metacritic ratings, and initial release date. It can sort in either direction by title, initial release date, IMDb, Rotten Tomatoes, or Metacritic. The active sort field and value are shown under every title so the current ordering is visible without opening a detail view.

Posters, ratings, and initial release date require an OMDb API key configured in Settings. The backend normalizes OMDb's `Released` value for the release-date sort/filter; unavailable values remain `Unknown`. The page and the core showtime table still work when that metadata is unavailable.

## Settings

Open `/settings`. There are two persistence scopes.

### Browser-local settings

**Theater search** stores a five-digit US ZIP plus a 1–100 mile radius. The default is `85004` / 25 miles. The backend resolves the ZIP, broadens Fandango discovery through nearby returned theater ZIP markets, deduplicates screenings, calculates exact straight-line theater distance, and removes theaters outside the configured radius.

**Preview time by chain** stores the number of minutes between the listed showtime and the actual movie start. `0` is valid. Blank means unknown. These browser settings live in `localStorage` and are mirrored into cookies so `/api/screenings` can apply them.

### Shared persistent settings

Home address, API credentials, and the A-List preference are stored server-side in `./common/settings.json`. Compose mounts the same host `./common` directory into Test and Production as `/srv/common`, so these deliberate user settings survive container/image replacement and are shared across environments. The file is git-ignored and written with restrictive permissions when the filesystem permits it.

The Settings API never returns saved API-key values. The UI can only see whether each key is configured. Entering a blank key leaves the existing key unchanged; explicit **Clear** buttons remove it.

**Home address** is geocoded through OpenStreetMap Nominatim and stored as the entered address, matched display address, and coordinates. Route estimates use OSRM's public driving router. These are static route estimates, not live-traffic predictions.

**AMC developer key** enables official AMC enrichment for matched AMC performances: display ticket price, A-List exclusion status, and reserved-seat availability where the issued key has access. If **I have AMC A-List** is enabled, a matched AMC performance is shown as `$0.00` only when official AMC attributes make eligibility known and do not contain the A-List exclusion. Missing attributes remain unknown. Geographic A-List plan-tier coverage is not inferred; the toggle assumes the user's plan covers the searched AMC locations.

**OMDb API key** enables posters plus IMDb, Rotten Tomatoes, Metacritic, and release-date metadata. Metadata failures are fail-soft: they produce `Unknown` values instead of preventing showtimes from loading.

### Provider cache and usage status

Optional enrichment APIs are protected by a persistent SQLite cache and request ledger at `./common/provider-cache.sqlite3`. Because Test and Production mount the same `./common`, a container restart or switching environments does not throw away cached provider responses or reset the app's request counters.

Current cache policy is intentionally conservative about request usage:

- OMDb successful title lookups: 7 days; missing-title responses: 6 hours. The app enforces a hard 1,000-request UTC-day budget before making an upstream call.
- AMC current-location showtime pages: 5 minutes.
- AMC theatre metadata: 30 days.
- AMC reserved-seat layouts: 5 minutes because availability is dynamic.
- An AMC seating `401`/`403` is remembered for 6 hours so a catalog-only key does not trigger one failed seating request per performance.
- Duplicate AMC performances in one response share one seat-layout lookup.

Settings shows requests made today, cache hits, percentage/estimated remaining for OMDb's published 1,000/day limit, and the time until the app's UTC accounting window rolls over. That countdown is **not claimed to be OMDb's provider reset time** because OMDb does not publish one. AMC request count/cache hits are always shown; AMC percentage/remaining/reset are shown only if AMC supplies rate-limit headers, because no public AMC quota is assumed by the app.

## Time model

Every screening always has a **Listed** time. A chain with configured preview minutes gets:

```text
actual start = listed showtime + preview minutes
end          = actual start + movie runtime
```

If runtime is unavailable, end remains unknown.

When a home address and route are also available:

```text
leave home = actual start - estimated drive-to minutes
back home  = estimated end + estimated drive-home minutes
```

Travel columns remain unknown when the chain preview time, runtime, theater coordinates, home address, or route estimate needed for the calculation is unavailable. After-midnight values use full datetimes and are displayed with `(+1d)` when appropriate.

## Seats and ticket prices

AMC is currently the authoritative provider for these fields. With a configured AMC developer key, the app matches Fandango screenings to official AMC performances by title, listed local time, and theater identity/location.

- **Ticket price** prefers the reported Adult price and includes any tax amount returned with that price. It is a display estimate; final checkout can differ.
- **Seats left** uses AMC's v3 reserved-seating layout and calculates available `CanReserve` positions divided by total `CanReserve` positions.
- If the key or seating permission is unavailable, or the AMC performance cannot be matched confidently, the values stay `Unknown`.
- Non-AMC theaters currently remain `Unknown` for price and seat percentage rather than using brittle checkout scraping.

## Run it

The intended deployment is Compose because shared settings and provider caches need a persistent host mount:

```bash
cp .env.example .env
docker compose up -d
```

The production image is multi-stage: Node builds the Vite/React application, then only compiled frontend assets are copied into the Python runtime image. Python serves the SPA and API from the same process.

Production tracks `:latest`; Test tracks `:test`. Their base screening caches are isolated in `./data` and `./data-test`, while deliberate user configuration and optional-provider cache/accounting are shared in `./common`.

For a one-off container, mount a common directory yourself:

```bash
docker run -d \
  --name movie-showtime-aggregator \
  -p 8080:8000 \
  -v "$PWD/common:/srv/common" \
  -e FANDANGO_ZIP_CODE=85004 \
  -e FANDANGO_RADIUS_MILES=25 \
  ghcr.io/wesnicol2/movie-showtime-aggregator:latest
```

Then open `http://<host>:8080/`. Health is at `http://<host>:8080/health`.

### Environment defaults

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `FANDANGO_ZIP_CODE` | no | `85004` | Default ZIP when the browser has no saved location |
| `FANDANGO_RADIUS_MILES` | no | `25` | Default theater radius, 1–100 miles |
| `FANDANGO_PAGE_LIMIT` | no | `50` | Theater results requested per upstream page |
| `CACHE_TTL_SECONDS` | no | `300` | In-memory Fandango response cache lifetime |
| `COMMON_DATA_DIR` | no | `common` | Server-side shared settings/provider-cache directory |
| `PROD_PORT` | no | `8080` | Host port for Production |
| `TEST_PORT` | no | `8081` | Host port for Test |
| `TZ` | no | `America/Phoenix` in `.env.example` | Container timezone |

API keys are intentionally entered through `/settings`, not committed to `.env` or the repository.

## Run from source

Install deterministic frontend dependencies and Python development dependencies:

```bash
npm ci
pip install -r requirements.txt
pip install -e ".[dev]"
```

For frontend development, run the Python API and Vite dev server in separate terminals:

```bash
python -m movie_showtime_aggregator.api --host 127.0.0.1 --port 8000
```

```bash
npm run dev
```

Vite proxies `/api` and `/health` to the Python process. Open the Vite URL printed in the terminal.

To exercise the same serving shape used by the production container without Docker, build first and then start Python:

```bash
npm run build
python -m movie_showtime_aggregator.api --host 0.0.0.0 --port 8000
```

The WSGI runtime serves the generated `frontend/dist` SPA in a source checkout and the copied package-static assets inside the production image.

## Verify changes

Install dependencies once for the checkout:

```bash
npm ci
pip install -r requirements.txt
pip install -e ".[dev]"
```

After editing frontend or Python code:

```bash
bash scripts/fix
```

Before every push:

```bash
bash scripts/verify
```

That repo-owned deterministic gate checks Biome, strict TypeScript, a Vite production build, Ruff lint/format, Python compilation, and pytest. CI then additionally builds the production Docker image, boots that exact image, and runs Playwright Chromium smoke coverage at desktop and mobile sizes with screening/settings API responses mocked. The browser smoke therefore verifies production asset serving and core UI state behavior without consuming Fandango, OMDb, or AMC quota.

A deployed Test environment remains the integration gate for real upstream credentials, networking, persistent volumes, AMC matching/seating permissions, and external-provider behavior.

## Endpoints

- `/` — spreadsheet-style screening workstation.
- `/movies` — poster-first Movie Selection page.
- `/settings` — browser settings plus shared server settings/integration credentials and provider usage/cache status.
- `/api/settings` — GET public settings/provider-usage state; POST shared settings. Secret values are never returned.
- `/api/screenings` — normalized/enriched screenings and facets. Direct API consumers can still use server-side `movie`, `theatre`, `format`, `start_after`, `start_before`, `end_by`, `preview=Chain:minutes`, `zip=`, `radius=`, and `date=` parameters; browser cookies take precedence for location/preview settings.
- `/health` — `{"status": "ok"}`.

## Project structure

- `frontend/` — React 19 + strict TypeScript + Vite UI, Zustand state, Biome configuration target, and Playwright smoke tests.
- `movie_showtime_aggregator/api.py` — WSGI API routes and production SPA/static-asset serving.
- `movie_showtime_aggregator/fandango.py` — base theater/showtime discovery.
- `movie_showtime_aggregator/location.py` — ZIP lookup and geographic calculations.
- `movie_showtime_aggregator/routing.py` — address geocoding and static driving-route estimates.
- `movie_showtime_aggregator/metadata.py` — optional OMDb poster/rating/release-date enrichment and persistent metadata cache use.
- `movie_showtime_aggregator/amc.py` — optional official AMC showtime/price/seating enrichment and provider cache use.
- `movie_showtime_aggregator/provider_cache.py` — shared persistent provider responses, request accounting, and observed rate-limit state.
- `movie_showtime_aggregator/enrichment.py` — fail-soft enrichment orchestration.
- `movie_showtime_aggregator/storage.py` — shared persistent user settings and secrets.
- `movie_showtime_aggregator/models.py` — normalized screening and derived fields.
- `movie_showtime_aggregator/service.py` — Fandango caching, radius discovery, facets, filters.
- `tests/` — Python unit/API tests, including the SPA-serving contract.
- `scripts/` — deterministic local fix/verification commands used by agents and CI.
- `Dockerfile` — multi-stage React build plus Python production runtime.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the branch/Test/Production process, [AGENTS.md](AGENTS.md) for architecture decisions, and [docs/design.md](docs/design.md) for the durable UI/UX contract.
