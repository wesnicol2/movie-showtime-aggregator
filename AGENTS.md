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

The home page is the product: one large screening table. There are no standalone
filter panels. Every displayed column is treated as a first-class sort/filter
dimension, using the familiar Excel table pattern:

- click the column label to sort;
- click the dropdown area of that header to open its filter menu;
- choose exact values with checkboxes;
- use type-aware rules such as contains/equals for text or before/after for time.

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

### The table is the filter UI

Do not add a separate filter panel or wizard. Column headers are the only primary
filter/sort surface. All columns should get the same basic affordance; variation
comes only from data type. Text columns get text operators, time columns get time
operators, and all columns get exact-value checkboxes.

The Chain column has one intentional extension: its menu also owns preview-minute
configuration because preview behavior is a property of theater chains.

### Keep table filtering client-side

The browser fetches the complete normalized market result and applies column
filtering/sorting in JavaScript. This is required for the spreadsheet-style UX:
checkbox and rule changes should feel immediate and should not cause repeated
upstream requests.

The Python service retains its server-side filter functions because the API can
still be used directly and those semantics remain independently testable.

### Saved Views stay local for now

A Saved View captures column filters, sort order, and chain preview-minute
settings. Saved Views use browser `localStorage`; they do not justify an account,
database, or backend persistence layer yet. Treat them as convenience state on
that browser, not portable user profile data.

### Preview rules belong to chains and are applied after caching

`ScreeningService` caches normalized upstream screenings with actual/end times
unknown. Preview minutes supplied by the browser are then applied per chain.
This means changing a preview value does not require another Fandango request;
it only recalculates against cached market data.

### Unknown time is a first-class state

`actual_start` and `estimated_end` are nullable. Timing filters exclude rows when
the time needed by that filter is unknown unless the user explicitly filters for
unknown values. A configured preview plus missing runtime produces a known actual
start and unknown end.

### Midnight rollover must compare full datetimes

A next-day `12:30 AM` is later than a same-day `7:00 PM`; clock-only comparisons
are incorrect. Time filtering must construct boundaries on the advertised
screening date and compare complete datetimes. Table display should mark a
next-day value (for example `12:30 AM (+1d)`) so the rollover is visible.

### Cache before filtering

The complete normalized market result is cached by date for five minutes by
default. Filtering and sorting operate on that result instead of triggering new
provider calls.

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
- Preview time is not a provider fact. It is user knowledge per chain and must
  stay unknown until configured.
- Time filtering previously compared only `HH:MM`, which broke after-midnight
  results. Always compare complete datetimes.
- The first UI used standalone filter panels. The product direction changed to
  an Excel-style table where headers own filtering and sorting; do not recreate
  the old panel UI.

## Things deliberately not done

- No geolocation, travel time, or leave-by calculation in MVP.
- No accounts or server-side saved-view persistence.
- No ratings or recommendation engine.
- No seat maps or ticket purchasing.
- No frontend framework or JavaScript build toolchain.
- No persistent server cache.
- No mypy, no ESLint. Ruff only. See `CONTRIBUTING.md`.
