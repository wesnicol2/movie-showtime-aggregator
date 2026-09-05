# AGENTS.md — why this repo is shaped the way it is

`README.md` covers how to use the app and `CONTRIBUTING.md` covers process; this file holds architectural intent and decisions future agents should preserve.

## Which docs an agent may change

**Keep current as you go — `README.md` and `AGENTS.md`.** If implementation contradicts either file, update it in the same work.

**Do not touch without explicit human approval — `CONTRIBUTING.md` and `docs/*.md`.** These are human-owned contracts.

## Local fix and verification contract

After editing Python, run:

```bash
bash scripts/fix
```

Before every push, run:

```bash
bash scripts/verify
```

The repo pins Ruff and CI invokes the exact same verification script. CI is confirmation, not the preferred place to discover deterministic lint/format/test failures. A deployed Test environment is still required for behavior involving containers, credentials, upstream services, networking, or persistent volumes.

---

## Product surfaces

The product has three intentional user-facing surfaces.

### Screening table

The home page is one large spreadsheet-style table. Do not recreate standalone filtering panels. Every displayed column is a first-class sort/filter dimension:

- click the column label to sort;
- click the dropdown side of the header to filter;
- all columns get exact-value checkboxes;
- text columns get text rules;
- time columns get time rules;
- numeric columns get numeric comparison rules.

New data should normally become another ordinary typed column rather than a special filter panel.

### Movie Selection

`/movies` is a poster-first, dark Now Playing grid inspired by the supplied AMC mobile layout. The poster tile itself is the checkbox; it should not become a detail-heavy card grid. Titles may appear below posters, and the page may expose lightweight sorting, but the posters remain the visual focus.

The selected movie titles live in browser local storage and are also the source of truth for the table's Movie exact-value filter. Changes from either surface should stay synchronized. This is browser convenience state, not an account/profile system.

### Settings

Application configuration belongs on `/settings`, never in table filter dropdowns. There are two persistence scopes and they must remain visibly distinct.

**Browser-local:** ZIP/radius and per-chain preview minutes. These use `localStorage` plus cookies because the screening endpoint must see them before returning calculated times/location results.

**Shared server settings:** home address/geocoded coordinates, AMC developer key, OMDb key, and A-List preference. These live in `./common/settings.json` through `SettingsStore`. Compose mounts the same `./common` directory into Test and Production as `/srv/common`, while caches remain isolated in `./data` and `./data-test`.

Never return stored API-key values to the browser. `/api/settings` may return booleans indicating whether a key is configured, but the key itself is write-only from the UI's point of view. `common/` is git-ignored. The current store is plaintext on the trusted home server with best-effort mode `0600`; do not describe it as encrypted.

## Core data model

Fandango remains the base screening provider. Every normalized row can then be enriched independently and fail-soft.

Base facts include movie, theater, chain, listed start, runtime, format, purchase URL, theater coordinates, and straight-line distance. Enrichment fields are nullable/defaulted so upstream enrichment failure never invalidates the base row.

The important derived timing model is:

```text
actual start = listed start + configured chain preview minutes
end          = actual start + runtime
leave home   = actual start - outbound drive estimate
back home    = end + return drive estimate
```

No preview duration is assumed. Missing preview means actual start/end/travel timing remain unknown. Missing runtime means end/back-home remain unknown. Missing home/theater route means leave/back-home remain unknown.

All time filtering compares complete datetimes. Do not regress to clock-only `HH:MM` comparisons; after-midnight rows must remain ordered correctly and display `(+1d)` when applicable.

## Location discovery

The product's location is ZIP + radius, not “whatever Fandango returns for one ZIP.” `ZipLocator` resolves the ZIP center, then `ScreeningService` starts with that Fandango market, probes a bounded set of geographically distributed returned theater ZIPs, deduplicates showtimes, calculates Haversine distance, and removes rows outside the requested radius.

The cache key is `(date, ZIP, radius)`. Preview settings are applied after base-screening caching so changing trailer time does not force another Fandango fetch.

Distance is straight-line distance, not drive distance. Drive estimates are a separate optional enrichment.

## Enrichment architecture

Enrichment is deliberately optional and must not make showtime retrieval brittle. A missing key, unavailable upstream API, unmatched movie/performance, or denied seating endpoint produces `Unknown`, not an error for the whole screening table.

### OMDb metadata

`metadata.py` supplies poster URL, IMDb ID/rating, Metacritic score, and Rotten Tomatoes percentage. `enrichment.py` queries unique titles concurrently and caches through `OmdbClient`.

The IMDb ID is also the stable bridge for source links:

- IMDb → exact IMDb title page;
- Letterboxd → `letterboxd.com/imdb/{tt...}/`, which redirects to the film;
- Rotten Tomatoes and Metacritic currently use provider search URLs for the title because OMDb does not supply canonical provider URLs.

Do not block base screenings when metadata lookup fails.

### AMC enrichment

`amc.py` uses the official AMC developer API with `X-AMC-Vendor-Key`. It fetches nearby official AMC showtimes and matches them to Fandango rows using movie title, listed local time, and theater identity/location.

Only confidently matched AMC performances may populate AMC-derived fields.

**Ticket price:** prefer a reported Adult price and include reported tax. Treat it as a display estimate; final checkout may differ.

**A-List:** the official performance attribute `NOALIST` / “Excluded from A-List” is the authoritative exclusion signal. If the user enables A-List, a matched AMC performance may be displayed as `$0.00` only when it is not excluded. The app does not infer geographic plan-tier eligibility; Settings explicitly says the toggle assumes the user's plan covers the searched locations.

**Seats left:** use the official reserved-seating layout when available. Calculate available / total reservable seats, excluding wheelchair and companion positions. Seating permission/API failure leaves this field unknown.

Do not scrape AMC checkout pages as a fallback for price or seat availability. Non-AMC ticket price/seats stay unknown until an equally defensible source is added.

### Home geocoding and routing

`routing.py` uses OpenStreetMap Nominatim to geocode the saved home address and public OSRM for static driving durations. Geocode once when Settings saves the address; persist the resulting coordinates. Route estimates are cached in-process by home/destination coordinates.

These are rough static drive estimates, not live traffic. Source links for Leave home / Back home should open the underlying OpenStreetMap/OSRM route.

## Cell-level provenance

Known externally sourced table values should be clickable to their most specific defensible source. Current intent:

- Movie → Letterboxd film;
- IMDb → IMDb;
- Rotten Tomatoes → Rotten Tomatoes;
- Metacritic → Metacritic;
- price/seats → matched AMC performance when AMC supplied them;
- leave/back-home → route source;
- Fandango-derived screening fields → Fandango screening/ticket URL.

Unknown values stay plain text. Never manufacture a source link solely to make the table look complete.

## Client-side table behavior

The browser fetches the complete normalized radius result once and performs table sort/filter changes client-side for immediate spreadsheet-like interaction. The Python server retains server-side filter helpers for direct API consumers and independent testing.

Saved Views remain browser-local table state only. Applying a Saved View also synchronizes any exact Movie selection into the poster-selection state. Application Settings are not part of a Saved View.

## Deployment shape

Two environments:

- Test follows GHCR `:test` from `feature/*`;
- Production follows `:latest` from `main`.

There is no per-dev environment. Dev branches get deterministic verification but no published image. Test and Production intentionally share `./common` settings while keeping mutable cache/data directories separate.

See `CONTRIBUTING.md` for the full promotion contract.

## Repo history worth not relearning

- A single Fandango ZIP response can omit nearby theaters; radius discovery therefore expands through nearby returned ZIP markets before enforcing the exact app-defined radius.
- Preview/trailer time is user knowledge, not a provider fact. It belongs in Settings and remains unknown until configured.
- Preview configuration briefly lived inside the Chain filter menu. It was intentionally moved out.
- The first UI used standalone filter panels. Product direction changed to an Excel-style table where headers own sorting/filtering.
- Time filtering once compared clock values and broke next-day rows. Always compare full datetimes.
- Ratings/posters are enrichment, not a dependency of screening retrieval.
- AMC price/A-List/seats should use the official AMC API and fail to Unknown rather than rely on checkout scraping.
- Shared API credentials must survive image/container replacement through the host-mounted common storage, not browser local storage or committed env files.
- Ruff formatting previously caused CI back-and-forth. Use `scripts/fix` and `scripts/verify` instead of guessing formatter output.

## Things deliberately not done

- No accounts or cross-device browser-state sync.
- No live-traffic ETA prediction.
- No automatic inference of AMC A-List geographic plan tier.
- No non-AMC price/seat scraping.
- No ticket purchasing inside the app.
- No frontend framework/build toolchain yet.
- No persistent server cache beyond deliberate shared settings; upstream caches remain in-process.
- No mypy or ESLint; Ruff is the Python gate.
