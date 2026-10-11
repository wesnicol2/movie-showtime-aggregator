import { useEffect, useMemo, useState } from "react";

import {
  availabilityForMovie,
  movieAvailabilityText,
  shortAvailabilityDate,
  useMovieAvailability,
} from "./movie-availability";
import { PLANNER_STORAGE_KEY, PLANNER_UPDATED_EVENT, readSavedMoviePlans } from "./planner";
import { browserDate } from "./show-date";
import { useAppStore } from "./store";
import type { MovieAvailabilitySummary } from "./types";
import { readWatchlistMetadata } from "./watchlist";
import "./watchlist.css";

type StatusFilter = "all" | "unplanned" | "planned" | "watched";
type WatchlistSort = "title" | "days" | "showtimes" | "release" | "imdb" | "rotten" | "metacritic";

interface Props {
  onBrowse: () => void;
  onPlan: () => void;
}

export function WatchlistPage({ onBrowse, onPlan }: Props) {
  const today = browserDate();
  const wanted = useAppStore((state) => state.selectedMovies);
  const watched = useAppStore((state) => state.watchedMovies);
  const response = useAppStore((state) => state.response);
  const setMovieWatched = useAppStore((state) => state.setMovieWatched);
  const removeWatchlistMovie = useAppStore((state) => state.removeWatchlistMovie);
  const [plans, setPlans] = useState(readSavedMoviePlans);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<WatchlistSort>("title");
  const { response: availability, error: availabilityError } = useMovieAvailability(today);

  useEffect(() => {
    const syncPlans = () => setPlans(readSavedMoviePlans());
    const onStorage = (event: StorageEvent) => {
      if (event.key === PLANNER_STORAGE_KEY) syncPlans();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(PLANNER_UPDATED_EVENT, syncPlans);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(PLANNER_UPDATED_EVENT, syncPlans);
    };
  }, []);

  const plannedDates = useMemo(() => {
    const result = new Map<string, string>();
    for (const plan of plans) {
      if (plan.date < today) continue;
      for (const movie of plan.itinerary.movies) {
        const previous = result.get(movie);
        if (!previous || plan.date < previous) result.set(movie, plan.date);
      }
    }
    return result;
  }, [plans, today]);

  const metadata = useMemo(() => {
    const cached = readWatchlistMetadata();
    // Prefer saved itinerary metadata when currently loaded screening data is absent.
    for (const plan of plans) {
      for (const screening of plan.screenings) {
        if (!cached[screening.movie]) {
          cached[screening.movie] = {
            poster_url: screening.poster_url,
            imdb_id: screening.imdb_id,
            imdb_rating: screening.imdb_rating,
            rotten_tomatoes_score: screening.rotten_tomatoes_score,
            metacritic_score: screening.metacritic_score,
            initial_release_date: screening.initial_release_date,
            letterboxd_url: screening.letterboxd_url,
          };
        }
      }
    }
    for (const screening of response?.screenings ?? []) {
      if (!cached[screening.movie]) {
        cached[screening.movie] = {
          poster_url: screening.poster_url,
          imdb_id: screening.imdb_id,
          imdb_rating: screening.imdb_rating,
          rotten_tomatoes_score: screening.rotten_tomatoes_score,
          metacritic_score: screening.metacritic_score,
          initial_release_date: screening.initial_release_date,
          letterboxd_url: screening.letterboxd_url,
        };
      }
    }
    return cached;
  }, [plans, response, wanted, watched]);

  const watchedSet = useMemo(() => new Set(watched), [watched]);
  const totalPlanned = wanted.filter((movie) => plannedDates.has(movie)).length;
  const entries = useMemo(() => {
    const names = [...new Set([...wanted, ...watched])];
    return names
      .filter((name) => {
        if (!name.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim())) return false;
        const isWatched = watchedSet.has(name);
        const planned = plannedDates.has(name);
        if (filter === "watched") return isWatched;
        if (isWatched) return filter === "all";
        return filter === "all" || (filter === "planned" ? planned : !planned);
      })
      .sort((a, b) => {
        if (sort === "title") return a.localeCompare(b);
        if (sort === "days" || sort === "showtimes") {
          const key: keyof MovieAvailabilitySummary =
            sort === "days" ? "scheduled_days" : "showtime_count";
          const left = availabilityForMovie(availability, a)?.[key];
          const right = availabilityForMovie(availability, b)?.[key];
          if (left !== undefined && left !== null && right !== undefined && right !== null) {
            return Number(left) - Number(right) || a.localeCompare(b);
          }
          return a.localeCompare(b);
        }
        const field = sort === "release" ? "initial_release_date"
          : sort === "imdb" ? "imdb_rating"
            : sort === "rotten" ? "rotten_tomatoes_score" : "metacritic_score";
        const left = metadata[a]?.[field] ?? null;
        const right = metadata[b]?.[field] ?? null;
        if (left === null && right === null) return a.localeCompare(b);
        if (left === null) return 1;
        if (right === null) return -1;
        return (sort === "release"
          ? String(right).localeCompare(String(left))
          : Number(right) - Number(left)) || a.localeCompare(b);
      });
  }, [wanted, watched, query, filter, watchedSet, plannedDates, sort, availability, metadata]);

  function markWatched(movie: string, isWatched: boolean): void {
    if (!isWatched && plannedDates.has(movie)) {
      if (!window.confirm(
        `Mark “${movie}” watched? Its saved future itinerary will remain on the calendar.`,
      )) return;
    }
    setMovieWatched(movie, !isWatched);
  }

  function removeMovie(movie: string): void {
    const date = plannedDates.get(movie);
    if (date && !window.confirm(
      `Remove “${movie}” from your watchlist? Its saved itinerary for ${shortAvailabilityDate(date)} will remain unchanged.`,
    )) return;
    removeWatchlistMovie(movie);
  }

  return (
    <section className="workspace watchlist-workspace" aria-labelledby="watchlist-heading">
      <header className="workspace-bar watchlist-header">
        <div>
          <p className="eyebrow">YOUR MOVIES</p>
          <h1 id="watchlist-heading">Watchlist</h1>
          <p className="watchlist-subtitle">Keep track of what you want to see, and what you've watched.</p>
        </div>
        <button className="primary-action" type="button" onClick={onBrowse}>
          Browse showtimes →
        </button>
      </header>

      <div className="watchlist-stats" aria-label="Watchlist summary">
        <div><strong>{wanted.length}</strong><span>Want to see</span></div>
        <div><strong>{totalPlanned}</strong><span>Planned</span></div>
        <div><strong>{wanted.length - totalPlanned}</strong><span>Unplanned</span></div>
        <div><strong>{watched.length}</strong><span>Watched</span></div>
      </div>

      <div className="watchlist-controls">
        <label className="watchlist-search">
          <span className="sr-only">Search watchlist</span>
          <input
            type="search"
            value={query}
            placeholder="Search your movies"
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search watchlist"
          />
        </label>
        <label className="watchlist-sort">
          <span>Sort</span>
          <select aria-label="Sort watchlist" value={sort}
            onChange={(event) => setSort(event.target.value as WatchlistSort)}>
            <option value="title">Title A–Z</option>
            <option value="days">Fewest listed days</option>
            <option value="showtimes">Fewest later showtimes</option>
            <option value="release">Newest release</option>
            <option value="imdb">Highest IMDb</option>
            <option value="rotten">Highest Rotten Tomatoes</option>
            <option value="metacritic">Highest Metacritic</option>
          </select>
        </label>
      </div>

      <div className="watchlist-tabs" role="group" aria-label="Watchlist status">
        {(["all", "unplanned", "planned", "watched"] as const).map((status) => (
          <button key={status} type="button" aria-pressed={filter === status}
            className={filter === status ? "active" : ""}
            onClick={() => setFilter(status)}>
            {status === "all" ? "All" : status[0].toUpperCase() + status.slice(1)}
          </button>
        ))}
      </div>

      <p className="watchlist-window">
        Later listings are counted strictly after {shortAvailabilityDate(today)} through{" "}
        {availability ? shortAvailabilityDate(availability.window_end) : "the next 14 days"}.
        {" "}These are published listings, not predicted theater exit dates.
        {availability?.unavailable_dates.length ? (
          <strong> {availability.unavailable_dates.length} dates could not be checked; counts are lower bounds.</strong>
        ) : null}
      </p>

      {entries.length === 0 ? (
        <div className="empty-state">
          {wanted.length + watched.length === 0
            ? "No movies yet. Browse showtimes to start your watchlist."
            : "No movies match this search or status."}
        </div>
      ) : (
        <div className="watchlist-items" aria-live="polite">
          {entries.map((movie) => {
            const info = metadata[movie];
            const isWatched = watchedSet.has(movie);
            const plannedDate = plannedDates.get(movie);
            const summary = availabilityForMovie(availability, movie);
            return (
              <article className="watchlist-item" key={movie}>
                <div className="watchlist-poster">
                  {info?.poster_url ? (
                    <img src={info.poster_url} loading="lazy" alt={`${movie} poster`} />
                  ) : (
                    <span aria-hidden="true">▶</span>
                  )}
                </div>
                <div className="watchlist-item-main">
                  <div className="watchlist-item-top">
                    <h2>{movie}</h2>
                    <span className="watchlist-status">
                      {isWatched ? "Watched" : plannedDate
                        ? `Planned · ${shortAvailabilityDate(plannedDate)}` : "Unplanned"}
                    </span>
                  </div>
                  {info?.initial_release_date ? (
                    <span className="watchlist-metadata">Released {info.initial_release_date}</span>
                  ) : null}
                  {info ? (
                    <div className="watchlist-ratings">
                      {info.imdb_rating !== null && info.imdb_rating !== undefined ? (
                        <span>IMDb {info.imdb_rating.toFixed(1)}</span>
                      ) : null}
                      {info.rotten_tomatoes_score !== null && info.rotten_tomatoes_score !== undefined ? (
                        <span>RT {info.rotten_tomatoes_score}%</span>
                      ) : null}
                      {info.metacritic_score !== null && info.metacritic_score !== undefined ? (
                        <span>MC {info.metacritic_score}</span>
                      ) : null}
                      {info.letterboxd_url ? (
                        <a href={info.letterboxd_url} target="_blank" rel="noreferrer">Letterboxd ↗</a>
                      ) : null}
                    </div>
                  ) : null}
                  {!isWatched ? (
                    <div className="watchlist-availability">
                      <strong>{movieAvailabilityText(summary, availability, availabilityError)}</strong>
                      {summary?.last_scheduled_date ? (
                        <span>Last listed {shortAvailabilityDate(summary.last_scheduled_date)}</span>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="watchlist-item-actions">
                    {!isWatched && !plannedDate ? (
                      <button type="button" onClick={onPlan}>Plan this movie</button>
                    ) : null}
                    <button type="button" onClick={() => markWatched(movie, isWatched)}>
                      {isWatched ? "Mark unwatched" : "Mark watched"}
                    </button>
                    <button className="watchlist-remove" type="button"
                      aria-label={`Remove ${movie} from watchlist`}
                      onClick={() => removeMovie(movie)}>Remove</button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
