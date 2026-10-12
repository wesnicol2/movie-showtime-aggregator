import { useEffect, useState } from "react";

import { fetchMovieAvailability } from "./api";
import type { MovieAvailabilityResponse, MovieAvailabilitySummary } from "./types";

const CACHE_LIFETIME_MS = 5 * 60 * 1000;
const cache = new Map<string, { expires: number; pending: Promise<MovieAvailabilityResponse> }>();

function loadAvailability(afterDate: string): Promise<MovieAvailabilityResponse> {
  // The theater search is carried by cookies, not explicit URL parameters.
  const cacheKey = `${afterDate}|${document.cookie}`;
  const saved = cache.get(cacheKey);
  if (saved && saved.expires > Date.now()) return saved.pending;
  const pending = fetchMovieAvailability(afterDate).catch((error: unknown) => {
    cache.delete(cacheKey);
    throw error;
  });
  cache.set(cacheKey, { pending, expires: Date.now() + CACHE_LIFETIME_MS });
  return pending;
}

export function useMovieAvailability(afterDate: string) {
  const [response, setResponse] = useState<MovieAvailabilityResponse | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setResponse(null);
    setError(false);
    void loadAvailability(afterDate)
      .then((result) => {
        if (!cancelled) setResponse(result);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [afterDate]);
  return { response, error };
}

export function availabilityForMovie(
  response: MovieAvailabilityResponse | null,
  movie: string,
): MovieAvailabilitySummary | null {
  if (!response) return null;
  return (
    response.movies[movie] ?? {
      scheduled_days: 0,
      showtime_count: 0,
      last_scheduled_date: null,
    }
  );
}

export function movieAvailabilityText(
  summary: MovieAvailabilitySummary | null,
  response: MovieAvailabilityResponse | null,
  error: boolean,
): string {
  if (error) return "Later showtimes unavailable";
  if (!response || !summary) return "Checking later listings…";
  const partial = response.unavailable_dates.length > 0;
  if (summary.scheduled_days === 0) {
    return partial ? "Later listings incomplete" : "No later showtimes listed";
  }
  const prefix = partial ? "At least " : "";
  return `${prefix}${summary.scheduled_days} listed day${summary.scheduled_days === 1 ? "" : "s"} · ${summary.showtime_count} showtime${summary.showtime_count === 1 ? "" : "s"}`;
}

export function shortAvailabilityDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}
