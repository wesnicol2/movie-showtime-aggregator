import { useEffect, useMemo, useRef, useState } from "react";

import { MovieFilterBar } from "./components/MovieFilterBar";
import "./movie-controls.css";
import {
  createMovieSavedView,
  type MovieSavedView,
  readMovieSavedViews,
  writeMovieSavedViews,
} from "./movie-saved-views";
import {
  activeMovieFilterCount,
  buildMovieOptions,
  compareMovies,
  EMPTY_MOVIE_FILTERS,
  filterMovies,
  type MovieFilters,
  type MovieSort,
  type MovieSortDirection,
  sortDirectionLabel,
  sortValueLabel,
} from "./movies";
import { readDefaultSavedView, writeDefaultSavedView } from "./saved-view-defaults";
import { useAppStore } from "./store";
import { useScreenings } from "./useScreenings";

export function MoviesPage() {
  useScreenings();
  const response = useAppStore((state) => state.response);
  const status = useAppStore((state) => state.status);
  const error = useAppStore((state) => state.error);
  const selectedMovies = useAppStore((state) => state.selectedMovies);
  const toggleMovie = useAppStore((state) => state.toggleMovie);
  const [sort, setSort] = useState<MovieSort>("title");
  const [sortDirection, setSortDirection] = useState<MovieSortDirection>("asc");
  const [filters, setFilters] = useState<MovieFilters>(EMPTY_MOVIE_FILTERS);
  const [savedViews, setSavedViews] = useState(readMovieSavedViews);
  const [selectedView, setSelectedView] = useState("");
  const [defaultView, setDefaultView] = useState(() => readDefaultSavedView("movies"));
  const defaultAppliedRef = useRef(false);

  useEffect(() => {
    if (defaultAppliedRef.current) return;
    defaultAppliedRef.current = true;
    if (!defaultView) return;
    const view = savedViews[defaultView];
    if (!view) {
      writeDefaultSavedView("movies", null);
      setDefaultView("");
      return;
    }
    setSelectedView(defaultView);
    setSort(view.sort);
    setSortDirection(view.sortDirection);
    setFilters(structuredClone(view.filters));
  }, [defaultView, savedViews]);

  const screenings = useMemo(() => response?.screenings ?? [], [response]);
  const allMovies = useMemo(() => buildMovieOptions(screenings), [screenings]);

  const movies = useMemo(
    () =>
      filterMovies(allMovies, new Set(selectedMovies), filters).sort((left, right) =>
        compareMovies(left.representative, right.representative, sort, sortDirection),
      ),
    [allMovies, filters, selectedMovies, sort, sortDirection],
  );

  const activeFilterCount = activeMovieFilterCount(filters);

  function changeSort(nextSort: MovieSort): void {
    setSort(nextSort);
    setSortDirection(nextSort === "title" ? "asc" : "desc");
  }

  function saveView(): void {
    const rawName = window.prompt("Name this movie view:");
    if (rawName === null) return;
    const name = rawName.trim();
    if (!name) return;
    if (savedViews[name] && !window.confirm(`Replace saved view “${name}”?`)) return;
    const view = createMovieSavedView(sort, sortDirection, filters);
    const next = { ...savedViews, [name]: view };
    writeMovieSavedViews(next);
    setSavedViews(next);
    setSelectedView(name);
  }

  function loadView(name: string): void {
    setSelectedView(name);
    if (!name) return;
    const view = savedViews[name];
    if (!view) return;
    applyMovieView(view);
  }

  function applyMovieView(view: MovieSavedView): void {
    setSort(view.sort);
    setSortDirection(view.sortDirection);
    setFilters(structuredClone(view.filters));
  }

  function deleteView(): void {
    if (!selectedView || !window.confirm(`Delete saved view “${selectedView}”?`)) return;
    const next = { ...savedViews };
    delete next[selectedView];
    writeMovieSavedViews(next);
    setSavedViews(next);
    if (defaultView === selectedView) {
      writeDefaultSavedView("movies", null);
      setDefaultView("");
    }
    setSelectedView("");
  }

  function toggleDefaultView(): void {
    if (!selectedView) return;
    const next = defaultView === selectedView ? "" : selectedView;
    writeDefaultSavedView("movies", next || null);
    setDefaultView(next);
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
            <span className="sr-only">Movie saved view</span>
            <select
              aria-label="Movie saved view"
              value={selectedView}
              onChange={(event) => loadView(event.target.value)}
            >
              <option value="">Saved views</option>
              {Object.keys(savedViews)
                .sort((left, right) => left.localeCompare(right))
                .map((name) => (
                  <option key={name} value={name}>
                    {name === defaultView ? `${name} · default` : name}
                  </option>
                ))}
            </select>
          </label>
          <button type="button" onClick={saveView}>
            Save view
          </button>
          <button
            type="button"
            disabled={!selectedView}
            aria-pressed={Boolean(selectedView) && selectedView === defaultView}
            onClick={toggleDefaultView}
          >
            {selectedView && selectedView === defaultView ? "Default ✓" : "Set default"}
          </button>
          <button type="button" disabled={!selectedView} onClick={deleteView}>
            Delete
          </button>
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

      <MovieFilterBar filters={filters} screenings={screenings} onChange={setFilters} />

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
