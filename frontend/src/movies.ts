import type { CheckboxOption } from "./components/CheckboxFilter";
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

/** `null` means every value is included, so the filter is inactive. */
export type CheckboxSelection = string[] | null;

export interface MovieFilters {
  title: string;
  selection: CheckboxSelection;
  theaters: CheckboxSelection;
  chains: CheckboxSelection;
  formats: CheckboxSelection;
  listedWindows: CheckboxSelection;
  minimumImdb: string;
  minimumRottenTomatoes: string;
  minimumMetacritic: string;
  releasedFrom: string;
  releasedThrough: string;
}

export const EMPTY_MOVIE_FILTERS: MovieFilters = {
  title: "",
  selection: null,
  theaters: null,
  chains: null,
  formats: null,
  listedWindows: null,
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

/** Listed-start buckets. Listed start is a provider fact, so it is never unknown. */
const LISTED_WINDOWS = [
  { value: "matinee", label: "Matinee · before 12pm", firstHour: 0, lastHour: 11 },
  { value: "afternoon", label: "Afternoon · 12–5pm", firstHour: 12, lastHour: 16 },
  { value: "evening", label: "Evening · 5–9pm", firstHour: 17, lastHour: 20 },
  { value: "late", label: "Late night · 9pm and later", firstHour: 21, lastHour: 23 },
] as const;

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

export function textOptions(
  screenings: readonly Screening[],
  key: "theatre" | "chain" | "format",
): CheckboxOption[] {
  return [...new Set(screenings.map((screening) => screening[key]))]
    .filter((value) => value !== "")
    .sort(compareText)
    .map((value) => ({ value, label: value }));
}

export function listedWindowOptions(screenings: readonly Screening[]): CheckboxOption[] {
  const present = new Set(screenings.map(listedWindow));
  return LISTED_WINDOWS.filter((window) => present.has(window.value)).map((window) => ({
    value: window.value,
    label: window.label,
  }));
}

export function listedWindow(screening: Screening): string | null {
  const hour = Number(screening.advertised_start.slice(11, 13));
  if (!Number.isFinite(hour)) return null;
  const match = LISTED_WINDOWS.find(
    (window) => hour >= window.firstHour && hour <= window.lastHour,
  );
  return match ? match.value : null;
}

export function activeMovieFilterCount(filters: MovieFilters): number {
  return Object.values(filters).filter((value) =>
    value === null ? false : typeof value === "string" ? value !== "" : true,
  ).length;
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
    hasScreeningFilter(filters) &&
    !movie.screenings.some((screening) => matchesScreeningFilters(screening, filters))
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

function hasScreeningFilter(filters: MovieFilters): boolean {
  return (
    filters.theaters !== null ||
    filters.chains !== null ||
    filters.formats !== null ||
    filters.listedWindows !== null
  );
}

/** A movie survives when one of its screenings satisfies every active screening filter. */
function matchesScreeningFilters(screening: Screening, filters: MovieFilters): boolean {
  if (filters.theaters !== null && !filters.theaters.includes(screening.theatre)) return false;
  if (filters.chains !== null && !filters.chains.includes(screening.chain)) return false;
  if (filters.formats !== null && !filters.formats.includes(screening.format)) return false;
  if (filters.listedWindows !== null) {
    const window = listedWindow(screening);
    if (window === null || !filters.listedWindows.includes(window)) return false;
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

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
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
