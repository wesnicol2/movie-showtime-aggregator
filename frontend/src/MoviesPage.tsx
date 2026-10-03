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
import { browserDate } from "./show-date";
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
  const setMovieSelection = useAppStore((state) => state.setMovieSelection);
  const planningDraftDate = useAppStore((state) => state.planningDraftDate);
  const planningDraftMovies = useAppStore((state) => state.planningDraftMovies);
  const setPlanningDraft = useAppStore((state) => state.setPlanningDraft);
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
  useEffect(() => {
    if (status !== "ready") return;
    if (planningDraftDate === selectedDate && planningDraftMovies !== null) return;

    const available = new Set(allMovies.map((movie) => movie.representative.movie));
    const candidates = selectedMovies.filter(
      (movie) => available.has(movie) && !plannedOnOtherDates.has(movie),
    );
    for (const movie of plannedThisDate) {
      if (available.has(movie) && !candidates.includes(movie)) candidates.push(movie);
    }
    setPlanningDraft(selectedDate, candidates);
  }, [
    allMovies,
    plannedOnOtherDates,
    plannedThisDate,
    planningDraftDate,
    planningDraftMovies,
    selectedDate,
    selectedMovies,
    setPlanningDraft,
    status,
  ]);

  const planningMovies = useMemo(
    () =>
      new Set(
        planningDraftDate === selectedDate && planningDraftMovies !== null
          ? planningDraftMovies
          : [],
      ),
    [planningDraftDate, planningDraftMovies, selectedDate],
  );

  const movies = useMemo(
    () =>
      filterMovies(allMovies, new Set(selectedMovies), filters).sort((left, right) =>
        compareMovies(left.representative, right.representative, sort, sortDirection),
      ),
    [allMovies, filters, selectedMovies, sort, sortDirection],
  );

  const activeFilterCount = activeMovieFilterCount(filters);

  function toggleMovieForDay(movie: string): void {
    if (plannedOnOtherDates.has(movie)) return;
    const current =
      planningDraftDate === selectedDate && planningDraftMovies !== null ? planningDraftMovies : [];
    if (current.includes(movie)) {
      setPlanningDraft(
        selectedDate,
        current.filter((candidate) => candidate !== movie),
      );
      return;
    }

    if (!selectedMovies.includes(movie)) {
      setMovieSelection([...selectedMovies, movie]);
    }
    setPlanningDraft(selectedDate, [...current, movie]);
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
          const locked = plannedElsewhere !== undefined;
          const statusLabel = plannedHere
            ? "Currently planned"
            : plannedElsewhere
              ? `Planned ${formatShortDate(plannedElsewhere)}`
              : selectedForDay
                ? wanted
                  ? "Wanted · this day"
                  : "This day"
                : wanted
                  ? "Wanted · not this day"
                  : "Available";

          return (
            <button
              key={screening.movie}
              type="button"
              className={`movie-tile ${selectedForDay ? "selected" : ""} ${locked ? "planned" : ""}`}
              aria-pressed={selectedForDay}
              aria-label={
                locked
                  ? `${screening.movie}: ${statusLabel}`
                  : `${selectedForDay ? "Remove" : "Add"} ${screening.movie} ${selectedForDay ? "from" : "to"} this day`
              }
              disabled={locked}
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
