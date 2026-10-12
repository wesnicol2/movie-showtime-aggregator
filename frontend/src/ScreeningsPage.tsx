import { useEffect, useMemo, useRef, useState } from "react";

import { ColumnFilter } from "./components/ColumnFilter";
import { MovieShowcase } from "./components/MovieShowcase";
import { ScreeningInspector } from "./components/ScreeningInspector";
import { ScreeningTable } from "./components/ScreeningTable";
import { readDefaultSavedView, writeDefaultSavedView } from "./saved-view-defaults";
import { filterAndSort, COLUMNS, isFilterActive } from "./screenings";
import { buildShowcase, sortShowcase, type ShowcaseSort } from "./showcase";
import {
  createSavedView,
  readSavedViews,
  type SavedView,
  useAppStore,
  writeSavedViews,
} from "./store";
import { useScreenings } from "./useScreenings";
import type { ColumnKey } from "./types";

export function ScreeningsPage() {
  useScreenings();
  const response = useAppStore((state) => state.response);
  const status = useAppStore((state) => state.status);
  const error = useAppStore((state) => state.error);
  const filters = useAppStore((state) => state.filters);
  const updateFilter = useAppStore((state) => state.updateFilter);
  const selectedMovies = useAppStore((state) => state.selectedMovies);
  const watchedMovies = useAppStore((state) => state.watchedMovies);
  const sort = useAppStore((state) => state.sort);
  const clearAllFilters = useAppStore((state) => state.clearAllFilters);
  const inspectedShowtimeId = useAppStore((state) => state.inspectedShowtimeId);
  const setInspectedShowtimeId = useAppStore((state) => state.setInspectedShowtimeId);
  const applySavedView = useAppStore((state) => state.applySavedView);
  const [view, setView] = useState<"movies" | "table">("movies");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [openColumn, setOpenColumn] = useState<ColumnKey | null>(null);
  const [movieSort, setMovieSort] = useState<ShowcaseSort>("title");
  const [movieSortDirection, setMovieSortDirection] = useState<"asc" | "desc">("asc");
  const [savedViews, setSavedViews] = useState(readSavedViews);
  const [selectedView, setSelectedView] = useState("");
  const [defaultView, setDefaultView] = useState(() => readDefaultSavedView("screenings"));
  const defaultAppliedRef = useRef(false);

  useEffect(() => {
    if (defaultAppliedRef.current) return;
    defaultAppliedRef.current = true;
    if (!defaultView) return;
    const view = savedViews[defaultView];
    if (!view) {
      writeDefaultSavedView("screenings", null);
      setDefaultView("");
      return;
    }
    setSelectedView(defaultView);
    applySavedView(view);
  }, [applySavedView, defaultView, savedViews]);

  const screenings = response?.screenings ?? [];
  const visible = useMemo(
    () => filterAndSort(screenings, filters, sort),
    [filters, screenings, sort],
  );
  const allMovies = useMemo(() => buildShowcase(screenings), [screenings]);
  const movies = useMemo(
    () => sortShowcase(buildShowcase(visible), movieSort, movieSortDirection),
    [visible, movieSort, movieSortDirection],
  );
  const activeFilterCount = Object.values(filters).filter(isFilterActive).length;

  function changeMovieSort(next: ShowcaseSort): void {
    setMovieSort(next);
    setMovieSortDirection(next === "title" || next === "distance_miles" ? "asc" : "desc");
  }
  const inspected =
    screenings.find((screening) => screening.showtime_id === inspectedShowtimeId) ?? null;

  function saveView(): void {
    const rawName = window.prompt("Name this filter view:");
    if (rawName === null) return;
    const name = rawName.trim();
    if (!name) return;
    if (savedViews[name] && !window.confirm(`Replace saved view “${name}”?`)) return;
    const view: SavedView = createSavedView(sort, filters);
    const next = { ...savedViews, [name]: view };
    writeSavedViews(next);
    setSavedViews(next);
    setSelectedView(name);
  }

  function loadView(name: string): void {
    setSelectedView(name);
    if (!name) return;
    const view = savedViews[name];
    if (view) applySavedView(view);
  }

  function deleteView(): void {
    if (!selectedView || !window.confirm(`Delete saved view “${selectedView}”?`)) return;
    const next = { ...savedViews };
    delete next[selectedView];
    writeSavedViews(next);
    setSavedViews(next);
    if (defaultView === selectedView) {
      writeDefaultSavedView("screenings", null);
      setDefaultView("");
    }
    setSelectedView("");
  }

  function toggleDefaultView(): void {
    if (!selectedView) return;
    const next = defaultView === selectedView ? "" : selectedView;
    writeDefaultSavedView("screenings", next || null);
    setDefaultView(next);
  }

  return (
    <section className="workspace" aria-labelledby="screenings-heading">
      <div className="workspace-bar">
        <div>
          <p className="eyebrow">DECISION WORKSPACE</p>
          <h1 id="screenings-heading">Now playing</h1>
          <p className="workflow-subtitle">One movie per listing · all theaters in your search area</p>
        </div>
        <div className="workspace-actions">
          <label className="select-label">
            <span className="sr-only">Saved view</span>
            <select
              aria-label="Screenings saved view"
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
          {activeFilterCount > 0 ? (
            <button type="button" onClick={clearAllFilters}>
              Clear {activeFilterCount}
            </button>
          ) : null}
        </div>
      </div>

      {status === "loading" ? (
        <div className="status-strip">Loading today’s screenings…</div>
      ) : null}
      {error ? (
        <div className="status-strip error" role="alert">
          {error}
        </div>
      ) : null}
      {response ? (
        <>
          <div className="showcase-toolbar">
            <fieldset className="showcase-tabs">
              <legend className="sr-only">Showtimes display</legend>
              <button type="button" aria-pressed={view === "movies"} onClick={() => { setView("movies"); setInspectedShowtimeId(null); }}>Movies</button>
              <button type="button" aria-pressed={view === "table"} onClick={() => { setView("table"); setOpenColumn(null); }}>Table</button>
            </fieldset>
            <div className="showcase-tools">
              {view === "movies" ? (
                <>
                  <label className="select-label">
                    <span className="sr-only">Sort movies</span>
                    <select aria-label="Sort movies" value={movieSort} onChange={(event) => changeMovieSort(event.target.value as ShowcaseSort)}>
                      <option value="title">Title</option>
                      <option value="initial_release_date">Release date</option>
                      <option value="imdb_rating">IMDb</option>
                      <option value="rotten_tomatoes_score">Rotten Tomatoes</option>
                      <option value="metacritic_score">Metacritic</option>
                      <option value="theaters">Theaters showing</option>
                      <option value="showtimes">Number of showtimes</option>
                      <option value="distance_miles">Nearest theater</option>
                    </select>
                  </label>
                  <button type="button" aria-label="Reverse movie sort" onClick={() => setMovieSortDirection((direction) => direction === "asc" ? "desc" : "asc")}>
                    {movieSortDirection === "asc" ? "↑ Ascending" : "↓ Descending"}
                  </button>
                </>
              ) : null}
              <button
                type="button"
                aria-label="Toggle screening filters"
                aria-expanded={filtersOpen}
                onClick={() => { setFiltersOpen((open) => !open); setOpenColumn(null); }}
              >
                Filters{activeFilterCount > 0 ? " (" + activeFilterCount + ")" : ""}
              </button>
            </div>
          </div>
          {filtersOpen ? (
            <fieldset className="showcase-filters">
              <legend className="sr-only">Screening filters</legend>
              {COLUMNS.map((column) => (
                <div className="showcase-filter-chip" key={column.key}>
                  <span>{column.label}</span>
                  <ColumnFilter
                    column={column}
                    filter={filters[column.key]}
                    screenings={screenings}
                    open={openColumn === column.key}
                    onOpenChange={(open) => setOpenColumn(open ? column.key : null)}
                    onChange={(patch) => updateFilter(column.key, patch)}
                  />
                </div>
              ))}
            </fieldset>
          ) : null}
          <div className="result-strip" aria-live="polite">
            {view === "movies" ? (
              <>
                <strong>{movies.length}</strong> of {allMovies.length} movies
                <span>·</span>
              </>
            ) : null}
            <span>{visible.length} of {screenings.length} screenings</span>
            <span>·</span>
            <span>
              {response.location.radius_miles} mi from {response.location.zip_code}
            </span>
            {activeFilterCount > 0 ? (
              <>
                <span>·</span>
                <span>{activeFilterCount} active filters</span>
              </>
            ) : null}
          </div>
          {view === "movies" ? (
            <>
              <MovieShowcase movies={movies} selectedMovies={selectedMovies} watchedMovies={watchedMovies} />
              {movies.length === 0 ? (
                <p className="empty-state">No movies match the current screening filters.</p>
              ) : null}
            </>
          ) : (
            <div className={`screening-layout ${inspected ? "with-inspector" : ""}`}>
              <div className="results-pane">
                <ScreeningTable
                  screenings={visible}
                  allScreenings={screenings}
                  filters={filters}
                  sort={sort}
                />
                {visible.length === 0 ? (
                  <p className="empty-state">No screenings match the active column filters.</p>
                ) : null}
              </div>
              {inspected ? (
                <ScreeningInspector
                  screening={inspected}
                  onClose={() => setInspectedShowtimeId(null)}
                />
              ) : null}
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
