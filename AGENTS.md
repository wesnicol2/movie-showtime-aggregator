# AGENTS.md — why this repo is shaped the way it is

The deep document. `README.md` covers how to use the app and `CONTRIBUTING.md`
covers process; this file holds the reasoning behind the code — the design
decisions, the constraints they answer to, and the things that were tried and
rejected.

## Which docs an agent may change

The documents in this repo are not equally open to edit. An assistant working
here should treat them as two tiers.

**Keep current as you go — `README.md` and `AGENTS.md`.** If a change you make
contradicts something either file says, update it in the same commit.

**Do not touch without explicit human approval — `CONTRIBUTING.md` and
`docs/*.md`.** These are the contracts. Ask first and get a clear yes, every
time.

---

## The core idea

The app answers a narrow question with as little ceremony as possible: "Of the
AMC screenings I care about, which ones actually start and end when I want?"
There is intentionally no search flow or movie detail navigation in the MVP.
The home page is the product: all normalized screenings in one list, with
checkbox/time controls that hide irrelevant rows.

AMC advertises a showtime before the feature itself begins. The app therefore
keeps three times distinct:

- advertised start — the time AMC publishes;
- estimated actual start — advertised start plus the configured preshow;
- estimated end — estimated actual start plus AMC's movie runtime.

The preshow is an estimate, not a claim that AMC starts every movie at exactly
that offset. It defaults to 25 minutes because that is the user's working rule
and lives in configuration so it can be changed without editing logic.

## Architecture decisions

### Use AMC's official REST API, behind a provider module

AMC exposes a developer API with theatre/date showtime resources. The showtime
payload already contains the data the MVP needs: title, local showtime, runtime,
premium format/attributes, sold-out state, and purchase URL. Using that source
avoids a second movie-metadata provider and avoids HTML parsing.

`amc.py` is deliberately the only code that knows AMC's HTTP shape. The rest of
the app consumes normalized `Screening` objects. Adding another chain later
should mean adding another provider/normalizer rather than teaching the UI about
another raw schema.

The tradeoff is authentication: live data requires `AMC_VENDOR_KEY`. The key is
configuration only and is never committed.

### Cache before filtering

One browser interaction can produce many filter changes. Those changes must not
become AMC API calls. `ScreeningService` caches the complete normalized theatre
set for a date, then every movie/theater/format/time filter operates on that
cached set. The default TTL is five minutes.

This is both faster and quota-friendlier than applying filters upstream.

### Keep filtering server-side, controls client-side

The page builds checkbox facets from the full result set. Any control change
immediately requests `/api/screenings` with filter query parameters; the request
hits the in-memory cache rather than AMC. Keeping filter semantics in Python
makes the behavior testable with the repo's existing Python-only CI contract and
avoids adding a JavaScript build/test toolchain for a tiny page.

### Keep the stdlib WSGI server for the MVP

The app needs three routes, a small JSON API, and static files. The template's
stdlib WSGI entrypoint is sufficient, so adding Flask/FastAPI would create a
runtime dependency without solving an MVP problem. Revisit this the moment
routing, validation, async I/O, or middleware becomes complex enough that the
stdlib starts fighting the application.

### Browser supplies "today"

The UI sends the browser's local calendar date to the API. That prevents a home
server/container timezone mismatch from accidentally loading the wrong day's
showtimes. The API still accepts an explicit `date` query parameter for tests
and future date selection.

## Deployment shape

Two environments — Test (`:test`) and Production (`:latest`) — each pinned to its
own GHCR tag, with Watchtower on the home server polling and recreating
containers. CI never reaches into the server. The full model is in
`CONTRIBUTING.md`.

There is deliberately no per-`dev/*` environment. Dev branches still get full
CI; verification against a running app happens on Test.

Registry auth uses the built-in `GITHUB_TOKEN` rather than a personal access
token.

## Repo history worth not relearning

- AMC's official developer API is preferable to scraping its public theater
  pages for this MVP. The theatre/date endpoint includes `runTime`, so deriving
  end time does not require TMDB, OMDb, Letterboxd, or another metadata call.
- The first UI implementation must distinguish "all selected" from "none
  selected." Omitting a repeated query parameter means no filter; an explicit
  empty selection therefore needs a sentinel value so Clear All does not
  accidentally show everything.

## Things deliberately not done

- No geolocation, travel time, or leave-by calculation in MVP.
- No accounts or saved preferences.
- No ratings or recommendation engine.
- No seat maps or ticket purchasing.
- No non-AMC chains yet, although normalized screenings are chain-neutral.
- No frontend framework or JavaScript toolchain. The page is plain HTML/CSS/JS.
- No persistent cache. Five-minute in-memory caching is enough until process
  restarts or upstream quota prove that assumption wrong.
- No mypy, no ESLint. Ruff only. See `CONTRIBUTING.md`.
