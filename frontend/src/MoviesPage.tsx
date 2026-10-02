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
import { readSavedMoviePlans } from "./planner";
import { readDefaultSavedView, writeDefaultSavedView } from "./saved-view-defaults";
import { useAppStore } from "./store";
import { useScreenings } from "./useScreenings";

interface Props {
  onBack: () => void;
  onContinue: () => void;
}

export function MoviesPage({ onBack, onContinue }: Props) {
  useScreenings();
  const response = useAppStore((state) => state.response);
  const status = useAppStore((state) => state.status);
  const error = useAppStore((state) => state.error);
  const selectedDate = useAppStore((state) => state.selectedDate);
  const selectedMovies = useAppStore((state) => state.selectedMovies);
  const toggleMovie = useAppStore((state) => state.toggleMovie);
  const [sort, setSort] = useState<MovieSort>("title");
  const [sortDirection, setSortDirection] = useState<MovieSortDirection>("asc");
  const [filters, setFilters] = useState<MovieFilters>(EMPTY_MOVIE_FILTERS);
  const [savedViews, setSavedViews] = useState(readMovieSavedViews);
  const [selectedView, setSelectedView] = useState("");
  const [defaultView, setDefaultView] = useState(() => readDefaultSavedView("movies"));
  const defaultAppliedRef = useRef(false);
  const plans = useMemo(readSavedMoviePlans, []);

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
  const plannedThisDate = useMemo(
    () => new Set(plans.find((plan) => plan.date === selectedDate)?.itinerary.movies ?? []),
    [plans, selectedDate],
  );
  const plannedOnOtherDates = useMemo(() => {
    const dates = new Map<string, string>();
    for (const plan of plans) {
      if (plan.date === selectedDate) continue;
      for (const movie of plan.itinerary.movies) {
        if (!dates.has(movie)) dates.set(movie, plan.date);
      }
    }
    return dates;
  }, [plans, selectedDate]);
  const planningMovies = useMemo(() => {
    const available = new Set(allMovies.map((movie) => movie.representative.movie));
    const candidates = new Set<string>();
    for (const movie of selectedMovies) {
      if (available.has(movie) && !plannedOnOtherDates.has(movie)) candidates.add(movie);
    }
    for (const movie of plannedThisDate) {
      if (available.has(movie)) candidates.add(movie);
    }
    return candidates;
  }, [allMovies, plannedOnOtherDates, plannedThisDate, selectedMovies]);

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
      <div className="workspace-bar movie-bar workflow-bar">
        <div>
          <p className="eyebrow">STEP 2 OF 3</p>
          <h1 id="movies-heading">Choose movies</h1>
          <p className="workflow-subtitle">{formatDate(selectedDate)}</p>
        </div>
        <div className="workflow-actions">
          <button type="button" onClick={onBack}>
            Calendar
          </button>
          <strong>{planningMovies.size} for this day</strong>
          <button
            className="primary-action"
            type="button"
            disabled={status !== "ready" || planningMovies.size === 0}
            onClick={onContinue}
          >
            Continue to planner →
          </button>
        </div>
      </div>

      <div className="result-strip movie-selection-summary" aria-live="polite">
        <strong>{selectedMovies.length}</strong> wanted overall
        <span>·</span>
        <span>Only movies playing on {formatShortDate(selectedDate)} are shown here</span>
        {plannedOnOtherDates.size > 0 ? (
          <>
            <span>·</span>
            <span>Already-planned movies are kept out of this day automatically</span>
          </>
        ) : null}
      </div>

      <MovieFilterBar filters={filters} screenings={screenings} onChange={setFilters} />

      <details className="movie-advanced-controls">
        <summary>Sort & saved views</summary>
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
        </div>
      </details>

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
          const wanted = selectedMovies.includes(screening.movie);
          const plannedHere = plannedThisDate.has(screening.movie);
          const plannedElsewhere = plannedOnOtherDates.get(screening.movie);
          const selectedForDay = planningMovies.has(screening.movie);
          const locked = plannedHere || plannedElsewhere !== undefined;
          const statusLabel = plannedHere
            ? "Planned this day"
            : plannedElsewhere
              ? `Planned ${formatShortDate(plannedElsewhere)}`
              : wanted
                ? "Wanted"
                : "Not wanted";

          return (
            <button
              key={screening.movie}
              type="button"
              className={`movie-tile ${selectedForDay ? "selected" : ""} ${locked ? "planned" : ""}`}
              aria-pressed={selectedForDay}
              aria-label={
                locked
                  ? `${screening.movie}: ${statusLabel}`
                  : `${wanted ? "Remove" : "Add"} ${screening.movie} ${wanted ? "from" : "to"} want list`
              }
              disabled={locked}
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
                <span className={`poster-status ${locked ? "planned" : ""}`}>{statusLabel}</span>
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

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}
