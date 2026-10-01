import {
  EMPTY_MOVIE_FILTERS,
  type MovieFilters,
  type MovieSort,
  type MovieSortDirection,
} from "./movies";

const MOVIE_SAVED_VIEWS_KEY = "movie-showtime-aggregator.movie-saved-views.v1";

export interface MovieSavedView {
  sort: MovieSort;
  sortDirection: MovieSortDirection;
  filters: MovieFilters;
}

export function createMovieSavedView(
  sort: MovieSort,
  sortDirection: MovieSortDirection,
  filters: MovieFilters,
): MovieSavedView {
  return { sort, sortDirection, filters: structuredClone(filters) };
}

export function readMovieSavedViews(): Record<string, MovieSavedView> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(MOVIE_SAVED_VIEWS_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([name, value]) => [name, normalizeMovieSavedView(value)] as const)
        .filter((entry): entry is readonly [string, MovieSavedView] => entry[1] !== null),
    );
  } catch {
    return {};
  }
}

export function writeMovieSavedViews(views: Record<string, MovieSavedView>): void {
  if (Object.keys(views).length === 0) {
    localStorage.removeItem(MOVIE_SAVED_VIEWS_KEY);
    return;
  }
  localStorage.setItem(MOVIE_SAVED_VIEWS_KEY, JSON.stringify(views));
}

function normalizeMovieSavedView(value: unknown): MovieSavedView | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<MovieSavedView>;
  if (!isMovieSort(candidate.sort) || !isMovieSortDirection(candidate.sortDirection)) return null;
  return {
    sort: candidate.sort,
    sortDirection: candidate.sortDirection,
    filters: normalizeMovieFilters(candidate.filters),
  };
}

function normalizeMovieFilters(value: unknown): MovieFilters {
  const candidate =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Partial<MovieFilters>)
      : {};
  return {
    ...structuredClone(EMPTY_MOVIE_FILTERS),
    theaters: checkboxSelection(candidate.theaters),
    chains: checkboxSelection(candidate.chains),
    formats: checkboxSelection(candidate.formats),
    listedWindows: checkboxSelection(candidate.listedWindows),
    title: stringValue(candidate.title),
    selection: checkboxSelection(candidate.selection),
    minimumImdb: stringValue(candidate.minimumImdb),
    minimumRottenTomatoes: stringValue(candidate.minimumRottenTomatoes),
    minimumMetacritic: stringValue(candidate.minimumMetacritic),
    releasedFrom: stringValue(candidate.releasedFrom),
    releasedThrough: stringValue(candidate.releasedThrough),
  };
}

function checkboxSelection(value: unknown): string[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) return null;
  return [...new Set(value.filter((item): item is string => typeof item === "string"))];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isMovieSort(value: unknown): value is MovieSort {
  return (
    value === "title" ||
    value === "initial_release_date" ||
    value === "imdb_rating" ||
    value === "rotten_tomatoes_score" ||
    value === "metacritic_score"
  );
}

function isMovieSortDirection(value: unknown): value is MovieSortDirection {
  return value === "asc" || value === "desc";
}
