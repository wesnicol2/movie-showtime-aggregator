# movie-showtime-aggregator

A deliberately small movie-showtime dashboard: one page and one spreadsheet-like
screening table. Every column can be sorted or filtered directly from its header,
using Excel-style value checkboxes plus type-aware text/time rules. The app
discovers theaters in a configured Fandango market and lets the user set preview
minutes independently for each theater chain.

> **Fresh from the template?** Work through
> [docs/new-repo-checklist.md](docs/new-repo-checklist.md) first. It covers the
> handful of things GitHub does not copy when you click *Use this template*.

## Table controls

Click a column name to sort it. Click the dropdown control at the right side of
any column header to filter that column. Every column supports value checkboxes;
text columns also support rules such as contains/equals/begins with, and time
columns support before/after/equal and unknown/not-unknown rules.

The **Chain** column menu also contains preview-minute settings because preview
time is chain-specific. **Saved views** in the top bar store the current filters,
sort order, and preview-minute settings in that browser's local storage so useful
combinations can be reapplied later without adding accounts or a database.

## Time model

Every screening always has a **listed** showtime. **Actual start** and **end** are
unknown until preview minutes are configured for that screening's chain.

For a configured chain:

```text
actual start = listed showtime + preview minutes
end          = actual start + movie runtime
```

If runtime is unavailable, actual start can still be calculated but end remains
unknown. Timing filters exclude rows whose required calculated time is unknown.

Preview settings are page state unless saved as part of a browser-local Saved
View.

## Run it

CI publishes the image to GHCR, so there's nothing to build:

```bash
docker run -d \
  --name movie-showtime-aggregator \
  -p 8080:8000 \
  -e FANDANGO_ZIP_CODE=85004 \
  ghcr.io/wesnicol2/movie-showtime-aggregator:latest
```

Then open `http://<host>:8080/`. Health is at `http://<host>:8080/health`.

Or use the compose file:

```bash
cp .env.example .env
docker compose up -d
```

That brings up production (`:latest`, `$PROD_PORT`) and test (`:test`,
`$TEST_PORT`). The two environments are described in
[CONTRIBUTING.md](CONTRIBUTING.md).

### Configuration

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `FANDANGO_ZIP_CODE` | no | `85004` | Market used to discover theaters with showtimes |
| `FANDANGO_PAGE_LIMIT` | no | `50` | Theater results requested per upstream page |
| `CACHE_TTL_SECONDS` | no | `300` | In-memory upstream response cache lifetime |
| `PROD_PORT` | no | `8080` | Host port for production |
| `TEST_PORT` | no | `8081` | Host port for test |
| `TZ` | no | `America/Phoenix` in `.env.example` | Container timezone |

There is no hardcoded theater list. The provider returns theaters for the
configured market ZIP, and the UI derives its table values and chain controls
from that result.

## Run from source

```bash
python -m movie_showtime_aggregator.api --host 0.0.0.0 --port 8000
```

Then open `http://localhost:8000/`.

## Test it

```bash
pip install -e ".[dev]"
ruff check && ruff format --check
python -m pytest tests/
```

CI runs these on every push, and a red check blocks promotion.

## Endpoints

- `/` — single-page showtime table.
- `/api/screenings` — normalized screenings and facets. It also retains optional
  server-side filter params (`movie`, `theatre`, `format`, `start_after`,
  `start_before`, `end_by`) for API consumers, plus `preview=Chain:minutes` and
  `date=YYYY-MM-DD`. The browser UI fetches the market data once and applies its
  Excel-style table filters client-side.
- `/health` — returns `{"status": "ok"}`.

## Project structure

- `movie_showtime_aggregator/api.py` — WSGI entrypoint and HTTP routes.
- `movie_showtime_aggregator/fandango.py` — theater discovery/showtime provider.
- `movie_showtime_aggregator/models.py` — normalization and time derivation.
- `movie_showtime_aggregator/service.py` — caching, aggregation, facets, filters.
- `movie_showtime_aggregator/static/` — the one-page table UI.
- `tests/` — unit/API tests.
- `docs/` — long-form specs and the new-repo checklist.

## Docs

- [CONTRIBUTING.md](CONTRIBUTING.md) — environments, branching, CI/CD, hygiene.
- [AGENTS.md](AGENTS.md) — why the code is shaped this way, and which docs an
  assistant may change on its own.
