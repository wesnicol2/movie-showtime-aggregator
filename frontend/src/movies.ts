import type { CheckboxOption } from "./components/CheckboxFilter";
import {
  activeFacetCount,
  type CheckboxSelection,
  compareText,
  EMPTY_SCREENING_FACETS,
  hasActiveFacet,
  matchesFacets,
  type ScreeningFacets,
} from "./screening-facets";
import type { Screening } from "./types";

export type MovieSort =
  | "title"
  | "initial_release_date"
  | "imdb_rating"
  | "rotten_tomatoes_score"
  | "metacritic_score";
export type MovieSortDirection = "asc" | "desc";

export interface MovieOption {
  representative: Screening;
  screenings: Screening[];
}

export interface MovieFilters extends ScreeningFacets {
  title: string;
  selection: CheckboxSelection;
  minimumImdb: string;
  minimumRottenTomatoes: string;
  minimumMetacritic: string;
  releasedFrom: string;
  releasedThrough: string;
}

export const EMPTY_MOVIE_FILTERS: MovieFilters = {
  ...EMPTY_SCREENING_FACETS,
  title: "",
  selection: null,
  minimumImdb: "",
  minimumRottenTomatoes: "",
  minimumMetacritic: "",
  releasedFrom: "",
  releasedThrough: "",
};

export const SELECTION_OPTIONS: readonly CheckboxOption[] = [
  { value: "selected", label: "Selected" },
  { value: "unselected", label: "Unselected" },
];

export function buildMovieOptions(screenings: readonly Screening[]): MovieOption[] {
  const unique = new Map<string, MovieOption>();
  for (const screening of screenings) {
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
}

export function activeMovieFilterCount(filters: MovieFilters): number {
  const text = [
    filters.title,
    filters.minimumImdb,
    filters.minimumRottenTomatoes,
    filters.minimumMetacritic,
    filters.releasedFrom,
    filters.releasedThrough,
  ].filter((value) => value !== "").length;
  return text + activeFacetCount(filters) + (filters.selection === null ? 0 : 1);
}

export function filterMovies(
  movies: readonly MovieOption[],
  selectedMovies: ReadonlySet<string>,
  filters: MovieFilters,
): MovieOption[] {
  return movies.filter((movie) => matchesMovieFilters(movie, selectedMovies, filters));
}

function matchesMovieFilters(
  movie: MovieOption,
  selectedMovies: ReadonlySet<string>,
  filters: MovieFilters,
): boolean {
  const representative = movie.representative;
  const title = filters.title.trim().toLocaleLowerCase();
  if (title && !representative.movie.toLocaleLowerCase().includes(title)) return false;

  if (filters.selection !== null) {
    const state = selectedMovies.has(representative.movie) ? "selected" : "unselected";
    if (!filters.selection.includes(state)) return false;
  }

  if (
    hasActiveFacet(filters) &&
    !movie.screenings.some((screening) => matchesFacets(screening, filters))
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

function numberFilter(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

export function compareMovies(
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

export function sortDirectionLabel(sort: MovieSort, direction: MovieSortDirection): string {
  if (sort === "title") return direction === "asc" ? "A → Z" : "Z → A";
  if (sort === "initial_release_date") {
    return direction === "asc" ? "Oldest → newest" : "Newest → oldest";
  }
  return direction === "asc" ? "Low → high" : "High → low";
}

export function sortValueLabel(movie: Screening, sort: MovieSort): string {
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
