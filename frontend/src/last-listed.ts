import { type Filters, filterAndSort, isFilterActive } from "./screenings";
import type { ShowcaseMovie } from "./showcase";
import type { ColumnKey, FutureScreening, Screening } from "./types";

type Listing = FutureScreening | Screening;

export interface LastListed {
  matching: Listing | null;
  overall: Listing | null;
  laterOutsideFilters: Listing | null;
  laterUnverified: Listing | null;
  futureFiltersUnverified: boolean;
}

// Future base listings intentionally exclude costly per-day metadata, pricing,
// seat availability, and home routing. Those filters must not quietly treat
// missing enrichment as a known value (including "Unknown" filters).
const UNVERIFIABLE_FUTURE_COLUMNS: readonly ColumnKey[] = [
  "imdb_rating",
  "rotten_tomatoes_score",
  "metacritic_score",
  "seats_left_percent",
  "ticket_price",
  "leave_home",
  "home_arrival",
];

const timeSort = { key: "advertised_start", direction: "desc" } as const;

function normalized(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function latest<T extends Listing>(rows: readonly T[]): T | null {
  let newest: T | null = null;
  for (const row of rows) {
    if (!newest || row.advertised_start > newest.advertised_start) newest = row;
  }
  return newest;
}

function matchesMovie(row: Listing, movie: ShowcaseMovie, ambiguousTitle: boolean): boolean {
  if (normalized(row.movie) !== normalized(movie.title)) return false;
  const sourceIds = movie.screenings.map((screening) => screening.movie_source_id).filter(Boolean);
  const imdbIds = movie.screenings.map((screening) => screening.imdb_id).filter(Boolean);
  if (row.movie_source_id && sourceIds.length) return sourceIds.includes(row.movie_source_id);
  if (row.imdb_id && imdbIds.length) return imdbIds.includes(row.imdb_id);
  // When two different films have the same name and a later listing lacks
  // compatible IDs, claiming it belongs to either would be misleading.
  return !ambiguousTitle;
}

export function latestListedForMovie(
  movie: ShowcaseMovie,
  allMovies: readonly ShowcaseMovie[],
  allToday: readonly Screening[],
  future: readonly FutureScreening[],
  filters: Filters,
): LastListed {
  const ambiguousTitle =
    allMovies.filter((item) => normalized(item.title) === normalized(movie.title)).length > 1;
  const belongs = (row: Listing) => matchesMovie(row, movie, ambiguousTitle);
  const futureFiltersUnverified = UNVERIFIABLE_FUTURE_COLUMNS.some((key) =>
    isFilterActive(filters[key]),
  );
  const futureMovieRows = future.filter(belongs);
  const matchingFuture = futureFiltersUnverified
    ? []
    : filterAndSort(futureMovieRows, filters, timeSort);
  const matching = latest([...movie.screenings, ...matchingFuture]);
  const unfiltered = [...allToday.filter(belongs), ...futureMovieRows];
  let laterOutsideFilters: Listing | null = null;
  let laterUnverified: Listing | null = null;
  for (const row of unfiltered) {
    if (matching && row.advertised_start <= matching.advertised_start) continue;
    const fromFuture = futureMovieRows.includes(row as FutureScreening);
    if (fromFuture && futureFiltersUnverified) {
      laterUnverified = latest([...(laterUnverified ? [laterUnverified] : []), row]);
    } else if (filterAndSort([row], filters, timeSort).length === 0) {
      laterOutsideFilters = latest([...(laterOutsideFilters ? [laterOutsideFilters] : []), row]);
    }
  }
  return {
    matching,
    overall: latest(unfiltered),
    laterOutsideFilters,
    laterUnverified,
    futureFiltersUnverified,
  };
}

export function formatListingDateTime(value: string): string {
  const date = new Date(value.slice(0, 10) + "T12:00:00Z");
  const displayed = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
  const hour = Number(value.slice(11, 13));
  const minutes = value.slice(14, 16);
  if (hour < 0 || hour > 23 || !/^\d{2}$/.test(minutes)) return displayed;
  return `${displayed} · ${hour % 12 || 12}:${minutes} ${hour < 12 ? "AM" : "PM"}`;
}

/**
 * The latest published listing is not a confirmed theatrical exit date.
 * Count calendar days from the selected date (not elapsed 24-hour periods),
 * and describe the horizon/partial results as lower bounds.
 */
export function describeListingRunway(
  latestStart: string,
  fromDate: string,
  windowEnd: string,
  incomplete: boolean,
): { label: string; urgent: boolean } {
  const utcDay = (value: string) => Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
  const daysLeft = Math.round((utcDay(latestStart) - utcDay(fromDate)) / 86_400_000);
  const horizonDays = Math.round((utcDay(windowEnd) - utcDay(fromDate)) / 86_400_000);
  if (!Number.isFinite(daysLeft) || daysLeft < 0)
    return { label: "No upcoming showtimes confirmed", urgent: false };

  if (daysLeft === 0)
    return {
      label: incomplete ? "Showtimes listed today" : "Last listed today",
      urgent: !incomplete,
    };

  const weeks = Math.floor(daysLeft / 7);
  const days = daysLeft % 7;
  const units = [
    ...(weeks ? [`${weeks} week${weeks === 1 ? "" : "s"}`] : []),
    ...(days ? [`${days} day${days === 1 ? "" : "s"}`] : []),
  ].join(" ");
  if (incomplete || daysLeft >= horizonDays)
    return { label: `At least ${units} of showtimes listed`, urgent: false };

  return {
    label: daysLeft === 1 ? "Last listed tomorrow" : `Last listed in ${units}`,
    urgent: daysLeft < 7,
  };
}
