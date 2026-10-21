import { useEffect, useMemo, useRef, useState } from "react";

import { MovieFilterBar } from "./components/MovieFilterBar";
import "./movie-controls.css";
import { MAX_MOVIES_PER_DAY } from "./movie-limits";
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
import { browserDate } from "./show-date";
import { useAppStore } from "./store";
import { useScreenings } from "./useScreenings";
import { readWatchlistMetadata } from "./watchlist";

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
  const watchedMovies = useAppStore((state) => state.watchedMovies);
  const setMovieSelection = useAppStore((state) => state.setMovieSelection);
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
    const today = browserDate();
    for (const plan of plans) {
      if (plan.date < today || plan.date === selectedDate) continue;
      for (const movie of plan.itinerary.movies) {
        if (!dates.has(movie)) dates.set(movie, plan.date);
      }
    }
    return dates;
  }, [plans, selectedDate]);
  // The persisted want list is the only source of truth. Never silently cap or
  // construct a different day-only selection that ranking cannot reproduce.
  const planningMovies = useMemo(() => {
    const available = new Set(allMovies.map((movie) => movie.representative.movie));
    return new Set(
      selectedMovies.filter(
        (movie) =>
          available.has(movie) && (!plannedOnOtherDates.has(movie) || plannedThisDate.has(movie)),
      ),
    );
  }, [allMovies, plannedOnOtherDates, plannedThisDate, selectedMovies]);
  const overLimit = planningMovies.size > MAX_MOVIES_PER_DAY;
  const wantedNotShowing = useMemo(() => {
    const available = new Set(allMovies.map((movie) => movie.representative.movie));
    return selectedMovies.filter((movie) => !available.has(movie));
  }, [allMovies, selectedMovies]);
  const wantedMetadata = readWatchlistMetadata();

  const movies = useMemo(
    () =>
      filterMovies(allMovies, new Set(selectedMovies), filters).sort((left, right) =>
        compareMovies(left.representative, right.representative, sort, sortDirection),
      ),
    [allMovies, filters, selectedMovies, sort, sortDirection],
  );

  const activeFilterCount = activeMovieFilterCount(filters);

  function toggleMovieForDay(movie: string): void {
    if (selectedMovies.includes(movie)) {
      setMovieSelection(selectedMovies.filter((value) => value !== movie));
      return;
    }
    // Planned elsewhere titles stay on the global want list but cannot be
    // double-booked. Other available movies count against the daily limit.
    if (
      (!plannedOnOtherDates.has(movie) || plannedThisDate.has(movie)) &&
      planningMovies.size >= MAX_MOVIES_PER_DAY
    )
      return;
    setMovieSelection([...selectedMovies, movie]);
  }

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
          <strong>
            {planningMovies.size} / {MAX_MOVIES_PER_DAY} for this day
          </strong>
          <button
            className="primary-action"
            type="button"
            disabled={status !== "ready" || planningMovies.size === 0 || overLimit}
            onClick={onContinue}
          >
            Continue to planner →
          </button>
        </div>
      </div>

      <div className="result-strip movie-selection-summary" aria-live="polite">
        <strong>{selectedMovies.length}</strong> wanted overall
        <span>·</span>
        <span>Wanted movies without showtimes are listed below</span>
        <span>·</span>
        <span>
          {overLimit
            ? `${planningMovies.size} selected · remove ${planningMovies.size - MAX_MOVIES_PER_DAY} to continue`
            : planningMovies.size === MAX_MOVIES_PER_DAY
              ? "20-movie limit reached · remove one to add another"
              : "Choose up to 20 movies for this day"}
        </span>
        {plannedOnOtherDates.size > 0 ? (
          <>
            <span>·</span>
            <span>Already-planned movies are kept out of this day automatically</span>
          </>
        ) : null}
      </div>

      {overLimit ? (
        <div className="status-strip error" role="alert">
          {planningMovies.size} movies selected for this day. Remove{" "}
          {planningMovies.size - MAX_MOVIES_PER_DAY} to continue to scheduling. Your wanted list has
          not been truncated.
        </div>
      ) : null}

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

      {status === "loading" && !response ? (
        <div className="status-strip">Loading movie listings…</div>
      ) : null}
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
          const alreadySeen = watchedMovies.includes(screening.movie);
          const plannedHere = plannedThisDate.has(screening.movie);
          const plannedElsewhere = plannedOnOtherDates.get(screening.movie);
          const selectedForDay = planningMovies.has(screening.movie);
          const full =
            !wanted &&
            (!plannedElsewhere || plannedHere) &&
            planningMovies.size >= MAX_MOVIES_PER_DAY;
          const statusLabel = full
            ? "20-movie limit reached"
            : plannedHere
              ? "Currently planned"
              : selectedForDay
                ? "Wanted · this day"
                : wanted && plannedElsewhere
                  ? `Wanted · planned ${formatShortDate(plannedElsewhere)}`
                  : wanted
                    ? "Wanted"
                    : plannedElsewhere
                      ? `Planned ${formatShortDate(plannedElsewhere)}`
                      : alreadySeen
                        ? "Already seen"
                        : "Available";

          return (
            <button
              key={screening.movie}
              type="button"
              className={`movie-tile ${wanted ? "selected" : ""} ${plannedElsewhere ? "planned" : ""}`}
              aria-pressed={wanted}
              aria-label={`${wanted ? "Remove" : "Add"} ${screening.movie} ${wanted ? "from" : "to"} wanted movies`}
              disabled={full}
              title={full ? "Remove a movie to add another (20 maximum)" : undefined}
              onClick={() => toggleMovieForDay(screening.movie)}
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
                <span className={`poster-status ${plannedElsewhere ? "planned" : ""}`}>
                  {statusLabel}
                </span>
              </span>
              <span className="movie-title">{screening.movie}</span>
              <span className="movie-sort-value">{sortValueLabel(screening, sort)}</span>
            </button>
          );
        })}
      </div>

      {status === "ready" && wantedNotShowing.length > 0 ? (
        <section className="movie-unavailable-wanted" aria-label="Wanted movies without showtimes">
          <h2>Wanted · not showing {formatShortDate(selectedDate)}</h2>
          <p>These movies remain wanted, but cannot be scheduled on this date.</p>
          <div className="movie-grid">
            {wantedNotShowing.map((movie) => {
              const poster = wantedMetadata[movie]?.poster_url;
              return (
                <button
                  key={movie}
                  type="button"
                  className="movie-tile selected"
                  aria-pressed="true"
                  aria-label={`Remove ${movie} from wanted movies`}
                  onClick={() => toggleMovieForDay(movie)}
                >
                  <span className="poster-frame">
                    {poster ? (
                      <img src={poster} alt={`${movie} poster`} loading="lazy" />
                    ) : (
                      <span className="poster-fallback">{movie}</span>
                    )}
                    <span className="poster-check" aria-hidden="true">
                      ✓
                    </span>
                    <span className="poster-status">Not showing this day</span>
                  </span>
                  <span className="movie-title">{movie}</span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}
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
