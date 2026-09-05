# AGENTS.md — why this repo is shaped the way it is

`README.md` covers how to use the app and `CONTRIBUTING.md` covers process; this
file holds the reasoning behind the code.

## Which docs an agent may change

**Keep current as you go — `README.md` and `AGENTS.md`.** If a change you make
contradicts something either file says, update it in the same work.

**Do not touch without explicit human approval — `CONTRIBUTING.md` and
`docs/*.md`.** These are the contracts. Ask first and get a clear yes, every
time.

## Local fix and verification contract

Agents are expected to have a local shell/runtime, but they do not need access
to a deployed Test environment to produce lint-clean, formatted, unit-tested
code.

After editing Python, run:

```bash
bash scripts/fix
```

Do not manually predict Ruff's formatting. The repository pins Ruff and the
script applies its safe lint fixes followed by its formatter. If an issue cannot
be auto-fixed, `bash scripts/verify` reports it for an explicit code change.

Before every push, run:

```bash
bash scripts/verify
```

This is a hard pre-push gate. It runs Ruff linting, Ruff's format check, syntax
compilation of tracked Python files, and pytest. CI invokes this exact same
script. CI is confirmation of local verification, not the first environment in
which an agent should discover formatting, lint, syntax, or unit-test failures.

A deployed Test environment has a different job: integration verification after
a `dev/*` branch is promoted to `feature/*`. Use Test for behavior that depends
on containers, networking, credentials, upstream services, persistent data, or
other runtime conditions that local unit tests do not reproduce.

---

## The core idea

The home page is the product: one large screening table. There are no standalone
filter panels. Every displayed column is treated as a first-class sort/filter
dimension, using the familiar Excel table pattern:

- click the column label to sort;
- click the dropdown area of that header to open its filter menu;
- choose exact values with checkboxes;
- use type-aware rules such as contains/equals for text or before/after for time.

Application configuration does not belong in those filter menus. Chain preview
minutes live on a separate Settings page so table controls stay focused on the
data currently being viewed.

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

Do not put application preferences into a column filter menu. Settings and table
filtering are intentionally separate concepts.

### Preview timing belongs on Settings

`/settings` is the single user-facing place to configure preview/trailer minutes
for theater chains. Values are browser-local and persist across reloads. The
Settings page stores them in `localStorage` and mirrors them into a browser cookie
so `/api/screenings` can apply the configured chain timing before returning
calculated start/end fields.

The settings cookie is authoritative for browser requests. Direct API consumers
without that cookie can still use `preview=Chain:minutes` query parameters.

### Keep table filtering client-side

The browser fetches the complete normalized market result and applies column
filtering/sorting in JavaScript. This is required for the spreadsheet-style UX:
checkbox and rule changes should feel immediate and should not cause repeated
upstream requests.

The Python service retains its server-side filter functions because the API can
still be used directly and those semantics remain independently testable.

### Saved Views stay local for now

Saved Views are for table state: useful filter/sort combinations that can be
reapplied quickly. They use browser `localStorage`; they do not justify an account,
database, or backend persistence layer yet. Treat them as convenience state on
that browser, not portable user profile data.

Preview timing is a global browser preference and conceptually belongs to
Settings, not to a Saved View. Older browser-local views may still contain legacy
preview state, but saved Settings take precedence at the API boundary.

### Preview rules belong to chains and are applied after caching

`ScreeningService` caches normalized upstream screenings with actual/end times
unknown. Preview minutes from Settings are then applied per chain. This means
changing a preview value does not require another Fandango request; it only
recalculates against cached market data.

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

There is deliberately no per-`dev/*` environment. Dev branches get full
verification but do not deploy; running integration verification happens on Test.

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
- Preview configuration briefly lived inside the Chain filter dropdown. It was
  intentionally moved to `/settings`; do not put app configuration back into
  table filters.
- Ruff formatting previously caused avoidable CI back-and-forth. The repo now
  pins Ruff and owns `scripts/fix` plus `scripts/verify`; agents should run those
  locally instead of guessing formatting or waiting for CI to teach them.

## Things deliberately not done

- No geolocation, travel time, or leave-by calculation in MVP.
- No accounts or server-side saved-view/settings persistence.
- No ratings or recommendation engine.
- No seat maps or ticket purchasing.
- No frontend framework or JavaScript build toolchain.
- No persistent server cache.
- No mypy, no ESLint. Ruff only. See `CONTRIBUTING.md`.
