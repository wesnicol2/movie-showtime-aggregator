# AGENTS.md — why this repo is shaped the way it is

`README.md` covers how to use the app and `CONTRIBUTING.md` covers process; this
file holds the reasoning behind the code.

## Which docs an agent may change

**Keep current as you go — `README.md` and `AGENTS.md`.** If a change you make
contradicts something either file says, update it in the same work.

**Do not touch without explicit human approval — `CONTRIBUTING.md` and
`docs/*.md`.** These are the contracts. Ask first and get a clear yes, every
time.

---

## The core idea

The home page is the product: all relevant movie screenings in one list, with
simple controls that remove options the user does not want.

The app keeps three times distinct:

- **listed start** — the showtime published by the theater;
- **actual start** — listed start plus that chain's user-configured preview time;
- **end** — actual start plus movie runtime.

A chain has no assumed preview time. If the user has not configured one, actual
start and end are unknown. A known runtime is not enough to calculate end until
actual start is known. This is intentional: the app must not present an invented
preview duration as fact.

## Architecture decisions

### Discover theaters by market instead of maintaining a theater list

The Fandango market endpoint returns theaters, chain identity, movies, runtimes,
formats, and showtimes for a ZIP-based market. `FANDANGO_ZIP_CODE` defines that
market; the UI is not location-aware and does not calculate travel distance.

The provider data is normalized before it reaches the rest of the application.
There is no hardcoded AMC theater list, and adding another theater returned by
the market requires no code change.

### Preview rules belong to chains and are applied after caching

`ScreeningService` caches normalized upstream screenings with actual/end times
unknown. Preview minutes supplied by the browser are then applied per chain.
This means changing a preview value is instant and does not cause another
upstream fetch.

Preview values are deliberately page state only in the MVP. No account, profile,
database, or saved preference model is justified yet.

### Unknown time is a first-class state

`actual_start` and `estimated_end` are nullable. Timing filters exclude rows when
the time needed by that filter is unknown; without a timing filter, those rows
remain visible. A configured preview plus missing runtime produces a known actual
start and unknown end.

### Cache before filtering

One browser interaction can produce many checkbox/time changes. The complete
normalized market result is cached by date for five minutes by default, then all
filtering and preview calculations happen against that cache.

### Keep filtering server-side, controls client-side

The page builds controls from facets returned by `/api/screenings`. Changes make
small API requests against cached data. Keeping filter semantics in Python makes
them directly testable without adding a JavaScript build/test toolchain.

### Keep the stdlib WSGI server for the MVP

The app still needs only a few routes, a JSON API, and static files. A framework
would add runtime surface area without solving a current problem.

### Browser supplies "today"

The UI sends the browser's local calendar date to avoid container-timezone drift.
The API also accepts an explicit date for tests and future date selection.

## Deployment shape

Two environments — Test (`:test`) and Production (`:latest`) — each pinned to its
own GHCR tag, with Watchtower polling on the home server. The full contract is in
`CONTRIBUTING.md`.

There is deliberately no per-`dev/*` environment. Dev branches get full CI but
do not deploy; running verification happens on Test.

## Repo history worth not relearning

- Fandango's ZIP-based theater-with-showtimes response already includes chain
  identity, runtime, formats, and ticket links, so the MVP does not need a
  separate movie-metadata service or a manually maintained theater list.
- The first UI implementation must distinguish "all selected" from "none
  selected." An explicit empty selection uses a sentinel so Clear All does not
  accidentally mean no filter.
- Preview time is not a provider fact. It is user knowledge per chain and must
  stay unknown until configured.

## Things deliberately not done

- No geolocation, travel time, or leave-by calculation in MVP.
- No accounts or persisted preview preferences.
- No ratings or recommendation engine.
- No seat maps or ticket purchasing.
- No frontend framework or JavaScript toolchain.
- No persistent cache.
- No mypy, no ESLint. Ruff only. See `CONTRIBUTING.md`.
