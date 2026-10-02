# AGENTS.md — why this repo is shaped the way it is

`README.md` covers how to use the app and `CONTRIBUTING.md` covers process; this file holds architectural intent and decisions future agents should preserve.

## Which docs an agent may change

**Keep current as you go — `README.md` and `AGENTS.md`.** If implementation contradicts either file, update it in the same work.

**Do not touch without explicit human approval — `CONTRIBUTING.md` and `docs/*.md`.** These are human-owned contracts.

## Local fix and verification contract

After editing frontend or Python code, run:

```bash
bash scripts/fix
```

Before every push, run:

```bash
npm ci
bash scripts/fix
bash scripts/verify
```

The repo pins the frontend toolchain and Ruff. CI invokes the same repo-owned verification script, so Biome, strict TypeScript, Vite production build, Ruff, syntax checks, and pytest are deterministic local gates. CI is confirmation, not the preferred place to discover deterministic failures. Do not commit directly to a `feature/*` branch while iterating: work on `dev/*`, verify there, and promote only green work. If the current tool environment cannot create a checkout and run the repo-owned commands, do not use a `feature/*` or `main` write as a substitute verification loop; keep the work isolated on `dev/*` until a verification-capable environment is available. A deployed Test environment is still required for behavior involving containers, credentials, upstream services, networking, or persistent volumes.

---

## Frontend architecture

The user interface is React 19 + TypeScript + Vite. Keep TypeScript strict. Biome is the only JS/TS formatter and linter. Zustand owns the small amount of explicit shared application state used to synchronize screenings, filters, Saved Views, movie selection, and inspection state.

The architecture is intentionally:

```text
Python backend / canonical logic
→ HTTP API contracts
→ typed frontend API layer
→ Zustand shared application state
→ React components
```

Do not recreate backend calculations, provider semantics, filtering semantics for API consumers, or enrichment logic in the browser. Client code may sort/filter already-loaded rows for immediate workstation interaction, but canonical screening values come from the backend.

Apache ECharts is not currently installed because the product has no analytical visualization that improves the primary decision. Add it only when a real chart use case exists; charts must consume application state rather than own it.

Keep component boundaries clear. Avoid monolithic page files and avoid using modal flows when a persistent inspector can preserve context.

## Product surfaces

The product has one primary planning workflow plus secondary inspection/settings surfaces. Preserve the orientation model: **Calendar → Movie Selection → Movie Day → Calendar**. A first-time user should not need to understand internal feature names or visit the showtime table to make a plan.

### Calendar

`/` is the infinite-scroll future calendar and the application home. It is the source of orientation: choosing a day sets the shared date and opens Movie Selection; locking an itinerary returns to the calendar focused on that same date. Saved current/future plans render inline on their dates.

The browser-local movie set is a durable **want list**, not a temporary table filter or a basket that is emptied after saving a plan. A wanted movie must always be explainable as planned on a current/future saved day, a candidate for the day currently being planned, or still unplanned. The calendar must surface unplanned wanted movies rather than silently losing them. Past plans do not satisfy the current/future planned invariant.

### Showtimes table

`/showtimes` is the spreadsheet-style power-user inspection surface. Do not recreate standalone filtering panels. Every displayed column is a first-class sort/filter dimension:

- click the column label to sort;
- click the dropdown side of the header to filter;
- all columns get exact-value checkboxes;
- text columns get text rules;
- time columns get time rules;
- numeric columns get numeric comparison rules.

New data should normally become another ordinary typed column rather than a special filter panel.

### Movie Selection

`/movies` is a poster-first, dark Now Playing grid inspired by the supplied AMC mobile layout. The poster tile itself is the checkbox; it should not become a detail-heavy card grid. The page may expose compact local filters and sorting controls, but posters remain the visual focus. When sorting by a field, show that field's value directly under each title so the ordering is auditable. Initial release date is one supported sort/filter dimension and must come from backend metadata rather than frontend inference.

Movie Selection's local filter panel is collapsed by default behind a compact **Filters** button. Keep the active-filter count on that button while collapsed and close any open checkbox submenu when collapsing the whole panel. This is a presentation choice only; filter state survives opening/closing the panel.

Discrete dimensions on this page are multi-value checkbox filters (selection state, theater, chain, format, listed showtime window) sharing the table's All/None value-menu vocabulary; open-ended ones stay typed inputs. The screening-derived facets come from `screening-facets.ts`, shared with Movie Day so both pages bucket listed time identically. `null` means every value is included, so an untouched filter is inactive and an emptied one legitimately matches nothing. Theater, chain, format, and listed time constrain screenings rather than movies: a movie survives when one of its screenings satisfies every active screening filter, so combining them answers "can I actually watch this here, in this format, at this time of day."

Listed showtime windows bucket the provider's listed start, never the calculated actual start, so they stay defined when preview minutes are unconfigured. New movie-page dimensions should normally become another checkbox filter over base screening facts rather than a bespoke control.

Wanted movie titles live in browser local storage independently from the Screening table's Movie filter. Do not couple the want list back to table filter state: clearing or loading Screening filters must never erase movie intent. This is browser convenience state, not an account/profile system.

### Movie Day

`/plan` is the final step of the calendar workflow. It consumes wanted movies that are available on the selected date while excluding movies already scheduled on another current/future day. The browser submits only eligible showtime IDs; the backend reloads canonical showtimes for the same date/location/preview cookies before planning.

The novice surface intentionally exposes only **How many movies?** (default **1**) and **Find itineraries**. Start/Home by, candidate editing, primary/secondary sort, transfer buffer, saved views, and showing facets belong under **Advanced options**. Ranking, pins, and runtime overrides belong under **Movie priorities & runtimes**. Keep the optimization power available, but do not make a first-time user parse it before producing a valid one-movie plan. Locking an itinerary preserves the want list and returns directly to the calendar.

Movie Day priority/pin state is browser-local planner preference state, separate from the shared selected-movie set. Preserve the user's ordering as selected titles are added or removed. The ranked movie array is submitted to the backend in priority order. With `N` selected movies, rank #1 is worth `N` points, rank #2 is worth `N-1`, down to one point for the last-ranked movie; an itinerary's want score is the sum of its included movies. Pins are submitted separately as `required_movies`.

The larger mathematical problem is a cardinality-constrained time-window routing problem, closely related to selective TSP/orienteering with fixed-duration appointments. Showings have a stronger forward-time structure than a generic TSP: represent them as nodes in a directed acyclic graph and add an edge only when a movie can end, travel to the next theater, include the requested transfer buffer, and reach the next calculated actual start.

**Watch is exact cardinality.** With `N` selected candidates and target `K`, every itinerary contains exactly one showing from exactly `K` distinct selected movies. When `K < N`, different feasible paths may omit different movies; do not pre-drop a fixed subset before solving. Every pinned/required movie must be present in every completion, so the number of pins may not exceed `K`; the UI must not offer a Watch count below the pin count. Keep the selected-pool cap at 10 unless the graph construction and combinatorial state growth are deliberately redesigned and benchmarked.

Start and End are planner constraints over canonical calculated timing: a used showing's actual start cannot precede Start, and its calculated end cannot exceed End. The UI may interpret an End clock time at or before a supplied Start as the following date, but the API accepts complete local datetimes and the backend compares those complete datetimes. Do not regress this to clock-only comparisons.

Dynamic programming counts exact feasible completions from `(showing, visited-movie-mask)` states and prunes paths that cannot reach the requested cardinality or still cover all required movie bits. Pins must be enforced in this completion state, not post-filtered after pagination/counting. Result ordering is a separate backend responsibility: best-first traversal uses monotone lower bounds (and the optimistic want-score upper bound) so the **primary sort and Secondary sort are applied globally before pagination**, never to only the browser's current page. The selectable objectives are full door-to-door **Minimum time**, full round-trip **Minimum driving**, and **Highest want score**. Secondary sort must differ from the primary objective. When the primary objective changes, the UI resets Secondary sort to the historical implicit tie-breaker so existing behavior is preserved by default: elapsed → driving, driving → elapsed, want → elapsed. The legacy want-score order still uses driving after equal score and equal elapsed time. API callers that omit `secondary_sort_by` receive those same defaults. A caller that explicitly chooses another secondary objective changes only the tie-break order after the primary metric; deterministic start/showtime identity remains after the requested ordering.

Same-theater transitions take zero minutes. Different-theater transitions use directional OSRM drive time and require coordinates/routes. Unknown preview or runtime makes that showing unplannable; missing cross-theater routing makes that transition infeasible. When Watch is smaller than the selected pool, missing/unplannable unpinned movies are not fatal unless fewer than `K` distinct movies remain. A missing/unplannable pinned movie is a hard conflict and must be reported explicitly. Each returned itinerary identifies which unpinned selected movies it omitted and includes its want score.

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

`metadata.py` supplies poster URL, IMDb ID/rating, Metacritic score, Rotten Tomatoes percentage, and normalized initial release date. `enrichment.py` queries unique titles concurrently and caches through `OmdbClient`. OMDb's `Released` value is normalized to an ISO date for frontend sort/filter use; missing or invalid values stay unknown.

Cache complete three-rating OMDb records for seven days, but cache matched records missing any rating, search responses, and misses for only six hours. Current theatrical records often acquire ratings shortly after their first lookup; treating a partial success as complete preserves stale `Unknown` values. Keep the Fandango-to-IMDb identity mapping long-lived so refreshing a partial record normally costs one OMDb ID lookup rather than repeating title resolution. Provider failures must be logged with the movie identity while remaining fail-soft for the screening response.

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

Movie Day routing uses OSRM's table service for a directional all-theater matrix and caches individual directed legs in-process. Preserve the one-call matrix behavior for the normal case rather than issuing one route request for each possible itinerary transition.

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

Saved Views remain browser-local table state only. They deliberately exclude the exact selected-movie set: saving strips it, loading preserves the current Movie Selection, and older stored views are migrated by stripping any saved exact selection. Non-selection Movie-column rules may still be saved. Application Settings are not part of a Saved View.

## Frontend production assets

Vite builds production assets; do not hand-edit compiled JavaScript or CSS. The production Docker image uses a Node build stage and then serves the compiled assets from the existing Python runtime. Development uses Vite's proxy for `/api` and `/health`.

The browser smoke suite must run against the built production container and mock screening/settings API responses so CI remains deterministic and does not consume provider quota.

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
- Movie Selection and Movie Day optional filter facets were later collapsed behind compact Filters buttons so filters remain available without dominating the primary selection/planning surfaces.
- Movie Day originally required every selected movie and enumerated in graph order. It intentionally became a cardinality-constrained optimizer so a user can ask for `K` of `N` movies, rank those candidates by personal priority, pin mandatory titles, and globally sort feasible paths by elapsed time, theater-to-theater driving, or want score. Secondary sort now makes the previously implicit tie-break objective explicit while retaining the old defaults.
- Time filtering once compared clock values and broke next-day rows. Always compare full datetimes.
- Ratings/posters are enrichment, not a dependency of screening retrieval.
- AMC price/A-List/seats should use the official AMC API and fail to Unknown rather than rely on checkout scraping.
- Shared API credentials must survive image/container replacement through the host-mounted common storage, not browser local storage or committed env files.
- Ruff formatting previously caused CI back-and-forth. Use `scripts/fix` and `scripts/verify` instead of guessing formatter output.
- The React modernization deliberately kept the old static UI serving until parity code passed deterministic verification; after cutover, do not reintroduce parallel frontend implementations.

## Things deliberately not done

- No accounts or cross-device browser-state sync.
- No live-traffic ETA prediction.
- No automatic inference of AMC A-List geographic plan tier.
- No non-AMC price/seat scraping.
- No ticket purchasing inside the app.
- No chart dependency without a concrete visualization use case.
- No persistent server cache beyond deliberate shared settings; upstream caches remain in-process.
- No mypy, ESLint, or Prettier; Ruff is the Python gate and Biome is the JS/TS gate.
