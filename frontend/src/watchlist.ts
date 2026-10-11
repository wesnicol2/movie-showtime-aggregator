import type { Screening } from "./types";

export const WATCHED_MOVIES_KEY = "movie-showtime-aggregator.watched-movies.v1";
const METADATA_KEY = "movie-showtime-aggregator.watchlist-metadata.v1";

export type WatchlistMetadata = Pick<
  Screening,
  | "poster_url"
  | "imdb_id"
  | "imdb_rating"
  | "rotten_tomatoes_score"
  | "metacritic_score"
  | "initial_release_date"
  | "letterboxd_url"
>;

export function readWatchedMovies(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(WATCHED_MOVIES_KEY) ?? "[]");
    return Array.isArray(value)
      ? [
          ...new Set(
            value.filter(
              (movie): movie is string => typeof movie === "string" && movie.trim().length > 0,
            ),
          ),
        ].sort()
      : [];
  } catch {
    return [];
  }
}

export function writeWatchedMovies(movies: readonly string[]): void {
  if (movies.length === 0) localStorage.removeItem(WATCHED_MOVIES_KEY);
  else localStorage.setItem(WATCHED_MOVIES_KEY, JSON.stringify([...new Set(movies)].sort()));
}

export function readWatchlistMetadata(): Record<string, WatchlistMetadata> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(METADATA_KEY) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return value as Record<string, WatchlistMetadata>;
  } catch {
    return {};
  }
}

export function cacheWatchlistMetadata(
  screenings: readonly Screening[],
  names: ReadonlySet<string>,
): void {
  if (names.size === 0 || screenings.length === 0) return;
  const cache = readWatchlistMetadata();
  let changed = false;
  for (const screening of screenings) {
    if (!names.has(screening.movie)) continue;
    const previous = cache[screening.movie];
    // Preserve already-enriched values when a later day has only base screenings.
    const next: WatchlistMetadata = {
      poster_url: screening.poster_url || previous?.poster_url || "",
      imdb_id: screening.imdb_id || previous?.imdb_id || "",
      imdb_rating: screening.imdb_rating ?? previous?.imdb_rating ?? null,
      rotten_tomatoes_score:
        screening.rotten_tomatoes_score ?? previous?.rotten_tomatoes_score ?? null,
      metacritic_score: screening.metacritic_score ?? previous?.metacritic_score ?? null,
      initial_release_date:
        screening.initial_release_date ?? previous?.initial_release_date ?? null,
      letterboxd_url: screening.letterboxd_url || previous?.letterboxd_url || "",
    };
    cache[screening.movie] = next;
    changed = true;
  }
  if (changed) localStorage.setItem(METADATA_KEY, JSON.stringify(cache));
}
