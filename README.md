# movie-showtime-aggregator

A deliberately small AMC showtime dashboard: one page, one screening list, and
filters for movie, theater, format, estimated movie start, and estimated end.
AMC advertised showtimes are adjusted by a configurable preshow estimate
(default: 25 minutes), then movie runtime is used to derive the end time.

> **Fresh from the template?** Work through
> [docs/new-repo-checklist.md](docs/new-repo-checklist.md) first. It covers the
> handful of things GitHub does not copy when you click *Use this template*.

## Run it

The app needs an AMC developer vendor key. Request access at the AMC developer
portal, then put the key in `.env` as `AMC_VENDOR_KEY`.

CI publishes the image to GHCR, so there's nothing to build:

```bash
docker run -d \
  --name movie-showtime-aggregator \
  -p 8080:8000 \
  -e AMC_VENDOR_KEY=your-key \
  ghcr.io/wesnicol2/movie-showtime-aggregator:latest
```

Then open `http://<host>:8080/`. Health is at `http://<host>:8080/health`.

Or use the compose file:

```bash
cp .env.example .env
docker compose up -d
```

That brings up **two** services: production (`:latest`, `$PROD_PORT`) and test
(`:test`, `$TEST_PORT`). The two environments are described in
[CONTRIBUTING.md](CONTRIBUTING.md).

### Configuration

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `AMC_VENDOR_KEY` | yes | — | AMC developer API credential |
| `AMC_THEATRES` | no | four Phoenix AMC theaters | Comma-separated `Theatre Name:id` entries |
| `AMC_PRESHOW_MINUTES` | no | `25` | Minutes added to AMC's advertised showtime |
| `CACHE_TTL_SECONDS` | no | `300` | In-memory AMC response cache lifetime |
| `PROD_PORT` | no | `8080` | Host port for production |
| `TEST_PORT` | no | `8081` | Host port for test |
| `TZ` | no | `America/Phoenix` in `.env.example` | Container timezone |

Default theaters are AMC Arizona Center 24, AMC DINE-IN Esplanade 14,
AMC DINE-IN Desert Ridge 18, and AMC Ahwatukee 24. Override `AMC_THEATRES` to
change the set without changing code.

## Run from source

```bash
export AMC_VENDOR_KEY=your-key
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

- `/` — single-page showtime dashboard.
- `/api/screenings` — normalized AMC screenings and filter facets. Optional
  query params: repeated `movie`, `theatre`, and `format`, plus `start_after`,
  `start_before`, `end_by`, and `date` (`YYYY-MM-DD`).
- `/health` — returns `{"status": "ok"}`.

## Project structure

- `movie_showtime_aggregator/api.py` — WSGI entrypoint and HTTP routes.
- `movie_showtime_aggregator/amc.py` — AMC REST client.
- `movie_showtime_aggregator/models.py` — normalization and time derivation.
- `movie_showtime_aggregator/service.py` — caching, aggregation, facets, filters.
- `movie_showtime_aggregator/static/` — the one-page UI.
- `tests/` — unit/API tests.
- `docs/` — long-form specs and the new-repo checklist.

## Docs

- [CONTRIBUTING.md](CONTRIBUTING.md) — environments, branching, CI/CD, hygiene.
- [AGENTS.md](AGENTS.md) — why the code is shaped this way, and which docs an
  assistant may change on its own.
