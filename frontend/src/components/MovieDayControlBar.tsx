import { useMemo, useState } from "react";
import {
  activeFacetCount,
  EMPTY_SCREENING_FACETS,
  listedWindowOptions,
  type ScreeningFacets,
  textOptions,
} from "../screening-facets";
import type { MovieDaySort, Screening } from "../types";
import { CheckboxFilter, type CheckboxOption } from "./CheckboxFilter";

type OpenControl = "movies" | keyof ScreeningFacets;

const SORT_OPTIONS: readonly { value: MovieDaySort; label: string }[] = [
  { value: "elapsed", label: "Minimum time" },
  { value: "driving", label: "Minimum driving" },
  { value: "want", label: "Highest want score" },
];

interface Props {
  facets: ScreeningFacets;
  screenings: readonly Screening[];
  selectedMovies: readonly string[];
  targetMovieCount: number | null;
  minimumTargetMovieCount: number;
  earliestTime: string;
  latestTime: string;
  sortBy: MovieDaySort;
  secondarySortBy: MovieDaySort;
  minimumBuffer: number;
  planning: boolean;
  disabled: boolean;
  onFacetsChange: (facets: ScreeningFacets) => void;
  onMovieSelectionChange: (movies: string[]) => void;
  onTargetMovieCountChange: (count: number | null) => void;
  onEarliestTimeChange: (value: string) => void;
  onLatestTimeChange: (value: string) => void;
  onSortByChange: (value: MovieDaySort) => void;
  onSecondarySortByChange: (value: MovieDaySort) => void;
  onMinimumBufferChange: (value: number) => void;
  onPlan: () => void;
}

export function MovieDayControlBar({
  facets,
  screenings,
  selectedMovies,
  targetMovieCount,
  minimumTargetMovieCount,
  earliestTime,
  latestTime,
  sortBy,
  secondarySortBy,
  minimumBuffer,
  planning,
  disabled,
  onFacetsChange,
  onMovieSelectionChange,
  onTargetMovieCountChange,
  onEarliestTimeChange,
  onLatestTimeChange,
  onSortByChange,
  onSecondarySortByChange,
  onMinimumBufferChange,
  onPlan,
}: Props) {
  const [showingFiltersOpen, setShowingFiltersOpen] = useState(false);
  const [openControl, setOpenControl] = useState<OpenControl | null>(null);
  const movies = useMemo(() => movieOptions(screenings), [screenings]);
  const theaters = useMemo(() => textOptions(screenings, "theatre"), [screenings]);
  const chains = useMemo(() => textOptions(screenings, "chain"), [screenings]);
  const formats = useMemo(() => textOptions(screenings, "format"), [screenings]);
  const listedWindows = useMemo(() => listedWindowOptions(screenings), [screenings]);
  const allMovieValues = movies.map((movie) => movie.value);
  const selectedMovieValues =
    selectedMovies.length === allMovieValues.length &&
    allMovieValues.every((movie) => selectedMovies.includes(movie))
      ? null
      : [...selectedMovies];
  const selectedCount = selectedMovies.length;
  const minimumWatchCount = Math.max(1, minimumTargetMovieCount);
  const activeShowingFilters = activeFacetCount(facets);

  function facetProps(key: keyof ScreeningFacets) {
    return {
      selected: facets[key],
      open: openControl === key,
      onOpenChange: (open: boolean) => setOpenControl(open ? key : null),
      onChange: (selected: string[] | null) => onFacetsChange({ ...facets, [key]: selected }),
    };
  }

  function toggleShowingFilters(): void {
    setShowingFiltersOpen((open) => {
      if (open) setOpenControl(null);
      return !open;
    });
  }

  return (
    <fieldset className="movie-day-controls">
      <legend className="sr-only">Movie Day planning controls</legend>

      <CheckboxFilter
        label="Movies"
        options={movies}
        selected={selectedMovieValues}
        open={openControl === "movies"}
        searchable
        onOpenChange={(open) => setOpenControl(open ? "movies" : null)}
        onChange={(selected) => onMovieSelectionChange(selected ?? allMovieValues)}
      />

      <label className="planner-control">
        <span>Watch</span>
        <select
          aria-label="Number of movies"
          value={targetMovieCount === null ? "all" : String(targetMovieCount)}
          disabled={selectedCount === 0}
          onChange={(event) =>
            onTargetMovieCountChange(
              event.target.value === "all" ? null : Number(event.target.value),
            )
          }
        >
          <option value="all">All selected ({selectedCount})</option>
          {Array.from({ length: Math.max(0, selectedCount - 1) }, (_, index) => index + 1)
            .filter((count) => count >= minimumWatchCount)
            .map((count) => (
              <option key={count} value={count}>
                {count} movie{count === 1 ? "" : "s"}
              </option>
            ))}
        </select>
      </label>

      <label className="planner-control">
        <span>Start</span>
        <input
          aria-label="Movie day start"
          type="time"
          value={earliestTime}
          onChange={(event) => onEarliestTimeChange(event.target.value)}
        />
      </label>

      <label className="planner-control">
        <span>Home by</span>
        <input
          aria-label="Movie day end"
          title="Latest time to arrive home after the final movie"
          type="time"
          value={latestTime}
          onChange={(event) => onLatestTimeChange(event.target.value)}
        />
      </label>

      <label className="planner-control">
        <span>Sort</span>
        <select
          aria-label="Sort itineraries"
          value={sortBy}
          onChange={(event) => onSortByChange(event.target.value as MovieDaySort)}
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="planner-control">
        <span>Secondary sort</span>
        <select
          aria-label="Secondary sort itineraries"
          value={secondarySortBy}
          onChange={(event) => onSecondarySortByChange(event.target.value as MovieDaySort)}
        >
          {SORT_OPTIONS.filter((option) => option.value !== sortBy).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="planner-control">
        <span>Transfer buffer</span>
        <span className="buffer-input">
          <input
            aria-label="Extra transfer buffer"
            type="number"
            min="0"
            max="180"
            value={minimumBuffer}
            onChange={(event) =>
              onMinimumBufferChange(Math.max(0, Math.min(180, Number(event.target.value) || 0)))
            }
          />
          min
        </span>
      </label>

      <div className="movie-day-action-row">
        <button
          type="button"
          className="movie-day-filter-toggle"
          aria-expanded={showingFiltersOpen}
          aria-controls="movie-day-showing-filters"
          aria-label={showingFiltersOpen ? "Hide showing filters" : "Show showing filters"}
          onClick={toggleShowingFilters}
        >
          <svg
            className="movie-day-filter-icon"
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M4 5h16l-6.5 7.5v5L10.5 19v-6.5L4 5Z" />
          </svg>
          <span>Filters</span>
          {activeShowingFilters > 0 ? (
            <span className="movie-day-filter-count" aria-hidden="true">
              {activeShowingFilters}
            </span>
          ) : null}
        </button>
        <button
          className="primary-action"
          type="button"
          disabled={planning || disabled}
          onClick={onPlan}
        >
          {planning ? "Planning…" : "Find combinations"}
        </button>
      </div>

      {showingFiltersOpen ? (
        <div id="movie-day-showing-filters" className="movie-day-showing-filters">
          <CheckboxFilter
            label="Theater"
            options={theaters}
            searchable
            {...facetProps("theaters")}
          />
          <CheckboxFilter label="Chain" options={chains} searchable {...facetProps("chains")} />
          <CheckboxFilter label="Format" options={formats} {...facetProps("formats")} />
          <CheckboxFilter
            label="Listed time"
            options={listedWindows}
            {...facetProps("listedWindows")}
          />
          <div className="movie-day-filter-actions">
            <button
              type="button"
              disabled={activeShowingFilters === 0}
              onClick={() => {
                setOpenControl(null);
                onFacetsChange(EMPTY_SCREENING_FACETS);
              }}
            >
              Clear showing filters
            </button>
          </div>
        </div>
      ) : null}
    </fieldset>
  );
}

function movieOptions(screenings: readonly Screening[]): CheckboxOption[] {
  return [...new Set(screenings.map((screening) => screening.movie))]
    .filter(Boolean)
    .sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }),
    )
    .map((movie) => ({ value: movie, label: movie }));
}
