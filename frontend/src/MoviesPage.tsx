import { useMemo, useState } from "react";

import "./movie-controls.css";
import { useAppStore } from "./store";
import type { Screening } from "./types";
import { useScreenings } from "./useScreenings";

type MovieSort =
  | "title"
  | "initial_release_date"
  | "imdb_rating"
  | "rotten_tomatoes_score"
  | "metacritic_score";
type MovieSortDirection = "asc" | "desc";
type SelectionFilter = "all" | "selected" | "unselected";

interface MovieOption {
  representative: Screening;
  screenings: Screening[];
}

interface MovieFilters {
  title: string;
  selection: SelectionFilter;
  theater: string;
  chain: string;
  minimumImdb: string;
  minimumRottenTomatoes: string;
  minimumMetacritic: string;
  releasedFrom: string;
  releasedThrough: string;
}

const EMPTY_FILTERS: MovieFilters = {
  title: "",
  selection: "all",
  theater: "",
  chain: "",
  minimumImdb: "",
  minimumRottenTomatoes: "",
  minimumMetacritic: "",
  releasedFrom: "",
  releasedThrough: "",
};

export function MoviesPage() {
  useScreenings();
  const response = useAppStore((state) => state.response);
  const status = useAppStore((state) => state.status);
  const error = useAppStore((state) => state.error);
  const selectedMovies = useAppStore((state) => state.selectedMovies);
  const toggleMovie = useAppStore((state) => state.toggleMovie);
  const [sort, setSort] = useState<MovieSort>("title");
  const [sortDirection, setSortDirection] = useState<MovieSortDirection>("asc");
  const [filters, setFilters] = useState<MovieFilters>(EMPTY_FILTERS);

  const allMovies = useMemo(() => {
    const unique = new Map<string, MovieOption>();
    for (const screening of response?.screenings ?? []) {
      const existing = unique.get(screening.movie);
      if (!existing) {
        unique.set(screening.movie, { representative: screening, screenings: [screening] });
        continue;
      }
      existing.screenings.push(screening);
      if (metadataCompleteness(screening) > metadataCompleteness(existing.representative)) {
        existing.representative = screening;
      }
    }
    return [...unique.values()];
  }, [response]);

  const theaters = useMemo(
    () =>
      [...new Set((response?.screenings ?? []).map((screening) => screening.theatre))].sort(
        compareText,
      ),
    [response],
  );
  const chains = useMemo(
    () =>
      [...new Set((response?.screenings ?? []).map((screening) => screening.chain))].sort(
        compareText,
      ),
    [response],
  );

  const movies = useMemo(() => {
    const selected = new Set(selectedMovies);
    return allMovies
      .filter((movie) => matchesMovieFilters(movie, selected, filters))
      .sort((left, right) =>
        compareMovies(left.representative, right.representative, sort, sortDirection),
      );
  }, [allMovies, filters, selectedMovies, sort, sortDirection]);

  const activeFilterCount = Object.entries(filters).filter(
    ([key, value]) => value !== "" && !(key === "selection" && value === "all"),
  ).length;

  function changeSort(nextSort: MovieSort): void {
    setSort(nextSort);
    setSortDirection(nextSort === "title" ? "asc" : "desc");
  }

  return (
    <section className="workspace movie-workspace" aria-labelledby="movies-heading">
      <div className="workspace-bar movie-bar">
        <div>
          <p className="eyebrow">NOW PLAYING</p>
          <h1 id="movies-heading">Choose movies</h1>
        </div>
        <div className="workspace-actions">
          <label className="select-label">
            <span className="sr-only">Sort movies</span>
            <select
              aria-label="Sort movies"
              value={sort}
              onChange={(event) => changeSort(event.target.value as MovieSort)}
            >
              <option value="title">Title</option>
              <option value="initial_release_date">Initial release date</option>
              <option value="imdb_rating">IMDb rating</option>
              <option value="rotten_tomatoes_score">Rotten Tomatoes</option>
              <option value="metacritic_score">Metacritic</option>
            </select>
          </label>
          <button
            type="button"
            aria-label="Reverse movie sort"
            onClick={() => setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"))}
          >
            {sortDirectionLabel(sort, sortDirection)}
          </button>
          <strong className="selection-count">{selectedMovies.length} selected</strong>
        </div>
      </div>

      <fieldset className="movie-filter-bar">
        <legend className="sr-only">Movie filters</legend>
        <label className="movie-filter-field title-filter">
          <span>Title</span>
          <input
            type="search"
            aria-label="Filter titles"
            placeholder="Filter titles"
            value={filters.title}
            onChange={(event) => setFilters({ ...filters, title: event.target.value })}
          />
        </label>
        <label className="movie-filter-field">
          <span>Selection</span>
          <select
            aria-label="Filter by selection"
            value={filters.selection}
            onChange={(event) =>
              setFilters({ ...filters, selection: event.target.value as SelectionFilter })
            }
          >
            <option value="all">All</option>
            <option value="selected">Selected</option>
            <option value="unselected">Unselected</option>
          </select>
        </label>
        <label className="movie-filter-field">
          <span>Theater</span>
          <select
            aria-label="Filter by theater"
            value={filters.theater}
            onChange={(event) => setFilters({ ...filters, theater: event.target.value })}
          >
            <option value="">All theaters</option>
            {theaters.map((theater) => (
              <option key={theater} value={theater}>
                {theater}
              </option>
            ))}
          </select>
        </label>
        <label className="movie-filter-field">
          <span>Chain</span>
          <select
            aria-label="Filter by chain"
            value={filters.chain}
            onChange={(event) => setFilters({ ...filters, chain: event.target.value })}
          >
            <option value="">All chains</option>
            {chains.map((chain) => (
              <option key={chain} value={chain}>
                {chain}
              </option>
            ))}
          </select>
        </label>
        <label className="movie-filter-field">
          <span>IMDb ≥</span>
          <input
            type="number"
            aria-label="Minimum IMDb"
            min="0"
            max="10"
            step="0.1"
            inputMode="decimal"
            value={filters.minimumImdb}
            onChange={(event) => setFilters({ ...filters, minimumImdb: event.target.value })}
          />
        </label>
        <label className="movie-filter-field">
          <span>RT ≥</span>
          <input
            type="number"
            aria-label="Minimum Rotten Tomatoes"
            min="0"
            max="100"
            step="1"
            inputMode="numeric"
            value={filters.minimumRottenTomatoes}
            onChange={(event) =>
              setFilters({ ...filters, minimumRottenTomatoes: event.target.value })
            }
          />
        </label>
        <label className="movie-filter-field">
          <span>MC ≥</span>
          <input
            type="number"
            aria-label="Minimum Metacritic"
            min="0"
            max="100"
            step="1"
            inputMode="numeric"
            value={filters.minimumMetacritic}
            onChange={(event) => setFilters({ ...filters, minimumMetacritic: event.target.value })}
          />
        </label>
        <label className="movie-filter-field">
          <span>Released from</span>
          <input
            type="date"
            aria-label="Initial release from"
            value={filters.releasedFrom}
            onChange={(event) => setFilters({ ...filters, releasedFrom: event.target.value })}
          />
        </label>
        <label className="movie-filter-field">
          <span>Released through</span>
          <input
            type="date"
            aria-label="Initial release through"
            value={filters.releasedThrough}
            onChange={(event) => setFilters({ ...filters, releasedThrough: event.target.value })}
          />
        </label>
        <div className="movie-filter-actions">
          <button
            type="button"
            disabled={activeFilterCount === 0}
            onClick={() => setFilters(EMPTY_FILTERS)}
          >
            Clear filters
          </button>
        </div>
      </fieldset>

      {status === "loading" ? <div className="status-strip">Loading posters…</div> : null}
      {error ? (
        <div className="status-strip error" role="alert">
          {error}
        </div>
      ) : null}
      {response && !response.preferences.omdb_api_key_set ? (
        <div className="status-strip">
          Add an OMDb API key in Settings to load posters, ratings, and release dates.
        </div>
      ) : null}
      {response ? (
        <div className="result-strip" aria-live="polite">
          <strong>{movies.length}</strong> of {allMovies.length} movies
          {activeFilterCount > 0 ? (
            <>
              <span>·</span>
              <span>{activeFilterCount} active filters</span>
            </>
          ) : null}
        </div>
      ) : null}

      {status === "ready" && allMovies.length === 0 ? (
        <p className="empty-state">No movies are playing in the current theater search.</p>
      ) : null}
      {status === "ready" && allMovies.length > 0 && movies.length === 0 ? (
        <p className="empty-state">No movies match the active movie filters.</p>
      ) : null}
      <div className="movie-grid" aria-live="polite">
        {movies.map((movie) => {
          const screening = movie.representative;
          const selected = selectedMovies.includes(screening.movie);
          return (
            <button
              key={screening.movie}
              type="button"
              className={`movie-tile ${selected ? "selected" : ""}`}
              aria-pressed={selected}
              aria-label={`${selected ? "Deselect" : "Select"} ${screening.movie}`}
              onClick={() => toggleMovie(screening.movie)}
            >
              <span className="poster-frame">
                {screening.poster_url ? (
                  <img
                    src={screening.poster_url}
                    alt={`${screening.movie} poster`}
                    loading="lazy"
                  />
                ) : (
                  <span className="poster-fallback">{screening.movie}</span>
                )}
                <span className="poster-check" aria-hidden="true">
                  ✓
                </span>
              </span>
              <span className="movie-title">{screening.movie}</span>
              <span className="movie-sort-value">{sortValueLabel(screening, sort)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function metadataCompleteness(movie: Screening): number {
  return [
    movie.poster_url,
    movie.initial_release_date,
    movie.imdb_rating,
    movie.rotten_tomatoes_score,
    movie.metacritic_score,
  ].filter((value) => value !== null && value !== "").length;
}

function numberFilter(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function matchesMovieFilters(
  movie: MovieOption,
  selectedMovies: Set<string>,
  filters: MovieFilters,
): boolean {
  const representative = movie.representative;
  const title = filters.title.trim().toLocaleLowerCase();
  if (title && !representative.movie.toLocaleLowerCase().includes(title)) return false;
  if (filters.selection === "selected" && !selectedMovies.has(representative.movie)) return false;
  if (filters.selection === "unselected" && selectedMovies.has(representative.movie)) return false;

  if (
    (filters.theater || filters.chain) &&
    !movie.screenings.some(
      (screening) =>
        (!filters.theater || screening.theatre === filters.theater) &&
        (!filters.chain || screening.chain === filters.chain),
    )
  ) {
    return false;
  }

  const minimumImdb = numberFilter(filters.minimumImdb);
  if (
    minimumImdb !== null &&
    (representative.imdb_rating === null || representative.imdb_rating < minimumImdb)
  ) {
    return false;
  }
  const minimumRottenTomatoes = numberFilter(filters.minimumRottenTomatoes);
  if (
    minimumRottenTomatoes !== null &&
    (representative.rotten_tomatoes_score === null ||
      representative.rotten_tomatoes_score < minimumRottenTomatoes)
  ) {
    return false;
  }
  const minimumMetacritic = numberFilter(filters.minimumMetacritic);
  if (
    minimumMetacritic !== null &&
    (representative.metacritic_score === null ||
      representative.metacritic_score < minimumMetacritic)
  ) {
    return false;
  }
  if (
    filters.releasedFrom &&
    (representative.initial_release_date === null ||
      representative.initial_release_date < filters.releasedFrom)
  ) {
    return false;
  }
  if (
    filters.releasedThrough &&
    (representative.initial_release_date === null ||
      representative.initial_release_date > filters.releasedThrough)
  ) {
    return false;
  }
  return true;
}

function compareMovies(
  left: Screening,
  right: Screening,
  sort: MovieSort,
  direction: MovieSortDirection,
): number {
  if (sort === "title") {
    const comparison = compareText(left.movie, right.movie);
    return direction === "asc" ? comparison : -comparison;
  }

  const leftValue = left[sort];
  const rightValue = right[sort];
  if (leftValue === null && rightValue === null) return compareText(left.movie, right.movie);
  if (leftValue === null) return 1;
  if (rightValue === null) return -1;

  const comparison =
    sort === "initial_release_date"
      ? String(leftValue).localeCompare(String(rightValue))
      : Number(leftValue) - Number(rightValue);
  const directed = direction === "asc" ? comparison : -comparison;
  return directed || compareText(left.movie, right.movie);
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function sortDirectionLabel(sort: MovieSort, direction: MovieSortDirection): string {
  if (sort === "title") return direction === "asc" ? "A → Z" : "Z → A";
  if (sort === "initial_release_date") {
    return direction === "asc" ? "Oldest → newest" : "Newest → oldest";
  }
  return direction === "asc" ? "Low → high" : "High → low";
}

function sortValueLabel(movie: Screening, sort: MovieSort): string {
  if (sort === "title") return `Title · ${movie.movie}`;
  if (sort === "initial_release_date") {
    return `Initial release · ${formatReleaseDate(movie.initial_release_date)}`;
  }
  if (sort === "imdb_rating") {
    return `IMDb · ${movie.imdb_rating === null ? "Unknown" : movie.imdb_rating.toFixed(1)}`;
  }
  if (sort === "rotten_tomatoes_score") {
    return `Rotten Tomatoes · ${formatPercent(movie.rotten_tomatoes_score)}`;
  }
  return `Metacritic · ${movie.metacritic_score === null ? "Unknown" : movie.metacritic_score}`;
}

function formatPercent(value: number | null): string {
  return value === null ? "Unknown" : `${value}%`;
}

function formatReleaseDate(value: string | null): string {
  if (!value) return "Unknown";
  const [year, month, day] = value.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) return value;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}
