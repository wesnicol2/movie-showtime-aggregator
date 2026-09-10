import { useMemo, useState } from "react";

import {
  activeMovieFilterCount,
  type CheckboxSelection,
  EMPTY_MOVIE_FILTERS,
  listedWindowOptions,
  type MovieFilters,
  SELECTION_OPTIONS,
  textOptions,
} from "../movies";
import type { Screening } from "../types";
import { CheckboxFilter } from "./CheckboxFilter";

type CheckboxFilterKey = "selection" | "theaters" | "chains" | "formats" | "listedWindows";

interface Props {
  filters: MovieFilters;
  screenings: readonly Screening[];
  onChange: (filters: MovieFilters) => void;
}

export function MovieFilterBar({ filters, screenings, onChange }: Props) {
  const [openFilter, setOpenFilter] = useState<CheckboxFilterKey | null>(null);
  const theaters = useMemo(() => textOptions(screenings, "theatre"), [screenings]);
  const chains = useMemo(() => textOptions(screenings, "chain"), [screenings]);
  const formats = useMemo(() => textOptions(screenings, "format"), [screenings]);
  const listedWindows = useMemo(() => listedWindowOptions(screenings), [screenings]);

  function checkboxProps(key: CheckboxFilterKey) {
    return {
      selected: filters[key],
      open: openFilter === key,
      onOpenChange: (open: boolean) => setOpenFilter(open ? key : null),
      onChange: (selected: CheckboxSelection) => onChange({ ...filters, [key]: selected }),
    };
  }

  return (
    <fieldset className="movie-filter-bar">
      <legend className="sr-only">Movie filters</legend>
      <label className="movie-filter-field title-filter">
        <span>Title</span>
        <input
          type="search"
          aria-label="Filter titles"
          placeholder="Filter titles"
          value={filters.title}
          onChange={(event) => onChange({ ...filters, title: event.target.value })}
        />
      </label>
      <CheckboxFilter
        label="Selection"
        options={SELECTION_OPTIONS}
        {...checkboxProps("selection")}
      />
      <CheckboxFilter
        label="Theater"
        options={theaters}
        searchable
        {...checkboxProps("theaters")}
      />
      <CheckboxFilter label="Chain" options={chains} searchable {...checkboxProps("chains")} />
      <CheckboxFilter label="Format" options={formats} {...checkboxProps("formats")} />
      <CheckboxFilter
        label="Listed time"
        options={listedWindows}
        {...checkboxProps("listedWindows")}
      />
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
          onChange={(event) => onChange({ ...filters, minimumImdb: event.target.value })}
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
          onChange={(event) => onChange({ ...filters, minimumRottenTomatoes: event.target.value })}
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
          onChange={(event) => onChange({ ...filters, minimumMetacritic: event.target.value })}
        />
      </label>
      <label className="movie-filter-field">
        <span>Released from</span>
        <input
          type="date"
          aria-label="Initial release from"
          value={filters.releasedFrom}
          onChange={(event) => onChange({ ...filters, releasedFrom: event.target.value })}
        />
      </label>
      <label className="movie-filter-field">
        <span>Released through</span>
        <input
          type="date"
          aria-label="Initial release through"
          value={filters.releasedThrough}
          onChange={(event) => onChange({ ...filters, releasedThrough: event.target.value })}
        />
      </label>
      <div className="movie-filter-actions">
        <button
          type="button"
          disabled={activeMovieFilterCount(filters) === 0}
          onClick={() => {
            setOpenFilter(null);
            onChange(EMPTY_MOVIE_FILTERS);
          }}
        >
          Clear filters
        </button>
      </div>
    </fieldset>
  );
}
