import { useEffect, useMemo, useState } from "react";

import { createMovieDayPlan } from "./api";
import { MovieDayControlBar } from "./components/MovieDayControlBar";
import { MoviePriorityEditor } from "./components/MoviePriorityEditor";
import "./movie-day.css";
import { saveMoviePlan, savedMoviePlanForDate } from "./planner";
import {
  activeFacetCount,
  EMPTY_SCREENING_FACETS,
  matchesFacets,
  type ScreeningFacets,
} from "./screening-facets";
import { filterAndSort, isFilterActive } from "./screenings";
import { useAppStore } from "./store";
import type { MovieDayItinerary, MovieDayPlanResponse, MovieDaySort, Screening } from "./types";
import { useScreenings } from "./useScreenings";

const PAGE_SIZE = 25;
const MOVIE_DAY_PREFERENCES_KEY = "movie-showtime-aggregator.movie-day-preferences.v1";

interface MovieDayPreferences {
  ranking: string[];
  pinned: string[];
  runtimeOverrides: Record<string, number>;
}

export function MovieDayPage() {
  useScreenings();
  const response = useAppStore((state) => state.response);
  const status = useAppStore((state) => state.status);
  const loadError = useAppStore((state) => state.error);
  const filters = useAppStore((state) => state.filters);
  const sort = useAppStore((state) => state.sort);
  const selectedMovies = useAppStore((state) => state.selectedMovies);
  const setMovieSelection = useAppStore((state) => state.setMovieSelection);
  const [minimumBuffer, setMinimumBuffer] = useState(0);
  const [facets, setFacets] = useState<ScreeningFacets>(EMPTY_SCREENING_FACETS);
  const [targetMovieCount, setTargetMovieCount] = useState<number | null>(null);
  const [earliestTime, setEarliestTime] = useState("");
  const [latestTime, setLatestTime] = useState("");
  const [sortBy, setSortBy] = useState<MovieDaySort>("elapsed");
  const [secondarySortBy, setSecondarySortBy] = useState<MovieDaySort>("driving");
  const [moviePreferences, setMoviePreferences] =
    useState<MovieDayPreferences>(readMovieDayPreferences);
  const [plan, setPlan] = useState<MovieDayPlanResponse | null>(null);
  const [planSignature, setPlanSignature] = useState("");
  const [planError, setPlanError] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  const [savedItineraryKey, setSavedItineraryKey] = useState<string | null>(null);

  const rankedMovies = useMemo(
    () => reconcileMovieRanking(moviePreferences.ranking, selectedMovies),
    [moviePreferences.ranking, selectedMovies],
  );
  const pinnedMovies = useMemo(() => {
    const selected = new Set(selectedMovies);
    return moviePreferences.pinned.filter((movie) => selected.has(movie));
  }, [moviePreferences.pinned, selectedMovies]);
  const runtimeOverrides = useMemo(() => {
    const overrides: Record<string, number> = {};
    for (const movie of selectedMovies) {
      const runtime = moviePreferences.runtimeOverrides[movie];
      if (runtime !== undefined) overrides[movie] = runtime;
    }
    return overrides;
  }, [moviePreferences.runtimeOverrides, selectedMovies]);
  const allScreenings = useMemo(() => response?.screenings ?? [], [response]);
  const defaultRuntimeByMovie = useMemo(() => {
    const runtimes: Record<string, number | null> = {};
    for (const movie of rankedMovies) {
      const screening = allScreenings.find(
        (candidate) => candidate.movie === movie && candidate.runtime_minutes !== null,
      );
      runtimes[movie] = screening?.runtime_minutes ?? null;
    }
    return runtimes;
  }, [allScreenings, rankedMovies]);
  const eligibleScreenings = useMemo(() => {
    const selected = new Set(selectedMovies);
    return filterAndSort(allScreenings, filters, sort).filter(
      (screening) => selected.has(screening.movie) && matchesFacets(screening, facets),
    );
  }, [allScreenings, facets, filters, selectedMovies, sort]);
  const screeningById = useMemo(
    () => new Map(allScreenings.map((screening) => [screening.showtime_id, screening])),
    [allScreenings],
  );
  const activeFilterCount = Object.values(filters).filter(isFilterActive).length;
  const activeShowingFilters = activeFacetCount(facets);
  const homeConfigured = response?.preferences.home_configured === true;
  const targetCount = targetMovieCount ?? selectedMovies.length;
  const responseDate = response?.date ?? "";
  const bounds = response
    ? dayBounds(response.date, earliestTime, latestTime)
    : { earliestStart: null, latestEnd: null, endNextDay: false };
  const runtimeSignature = rankedMovies
    .map((movie) => `${movie}:${runtimeOverrides[movie] ?? ""}`)
    .join("|");
  const inputSignature = [
    minimumBuffer,
    activeShowingFilters,
    targetCount,
    earliestTime,
    latestTime,
    sortBy,
    secondarySortBy,
    rankedMovies.join("|"),
    pinnedMovies.join("|"),
    runtimeSignature,
    eligibleScreenings.map((screening) => screening.showtime_id).join("|"),
  ].join("::");

  useEffect(() => {
    setMoviePreferences((current) => {
      const ranking = reconcileMovieRanking(current.ranking, selectedMovies);
      const selected = new Set(selectedMovies);
      const pinned = current.pinned.filter((movie) => selected.has(movie));
      return arraysEqual(current.ranking, ranking) && arraysEqual(current.pinned, pinned)
        ? current
        : { ...current, ranking, pinned };
    });
  }, [selectedMovies]);

  useEffect(() => {
    persistMovieDayPreferences(moviePreferences);
  }, [moviePreferences]);

  useEffect(() => {
    if (targetMovieCount !== null && targetMovieCount >= selectedMovies.length) {
      setTargetMovieCount(null);
    }
  }, [selectedMovies.length, targetMovieCount]);

  useEffect(() => {
    if (targetMovieCount !== null && targetMovieCount < pinnedMovies.length) {
      setTargetMovieCount(pinnedMovies.length);
    }
  }, [pinnedMovies.length, targetMovieCount]);

  useEffect(() => {
    if (plan && planSignature !== inputSignature) setPlan(null);
  }, [inputSignature, plan, planSignature]);

  useEffect(() => {
    if (!responseDate) {
      setSavedItineraryKey(null);
      return;
    }
    const saved = savedMoviePlanForDate(responseDate);
    setSavedItineraryKey(saved ? itineraryKey(saved.itinerary) : null);
  }, [responseDate]);

  function moveMovie(movie: string, direction: -1 | 1): void {
    setMoviePreferences((current) => {
      const ranking = reconcileMovieRanking(current.ranking, selectedMovies);
      const index = ranking.indexOf(movie);
      const destination = index + direction;
      if (index < 0 || destination < 0 || destination >= ranking.length) return current;
      const next = [...ranking];
      const currentMovie = next[index];
      const destinationMovie = next[destination];
      if (currentMovie === undefined || destinationMovie === undefined) return current;
      next[index] = destinationMovie;
      next[destination] = currentMovie;
      return { ...current, ranking: next };
    });
  }

  function togglePinned(movie: string): void {
    if (!selectedMovies.includes(movie)) return;
    setMoviePreferences((current) => {
      const pinned = current.pinned.includes(movie)
        ? current.pinned.filter((value) => value !== movie)
        : [...current.pinned, movie];
      return { ...current, pinned };
    });
  }

  function setRuntimeOverride(movie: string, minutes: number | null): void {
    if (!selectedMovies.includes(movie)) return;
    if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > 600)) return;
    setMoviePreferences((current) => {
      const next = { ...current.runtimeOverrides };
      if (minutes === null) delete next[movie];
      else next[movie] = minutes;
      return { ...current, runtimeOverrides: next };
    });
  }

  function changeSortBy(value: MovieDaySort): void {
    setSortBy(value);
    setSecondarySortBy(defaultSecondarySort(value));
  }

  async function generate(offset = 0): Promise<void> {
    if (!response || rankedMovies.length === 0 || targetCount === 0) return;
    setPlanning(true);
    setPlanError(null);
    try {
      const nextPlan = await createMovieDayPlan({
        date: response.date,
        movies: rankedMovies,
        required_movies: pinnedMovies,
        runtime_overrides: runtimeOverrides,
        showtime_ids: eligibleScreenings.map((screening) => screening.showtime_id),
        target_movie_count: targetCount,
        sort_by: sortBy,
        secondary_sort_by: secondarySortBy,
        earliest_start: bounds.earliestStart,
        latest_end: bounds.latestEnd,
        minimum_buffer_minutes: minimumBuffer,
        offset,
        limit: PAGE_SIZE,
      });
      setPlan(nextPlan);
      setPlanSignature(inputSignature);
    } catch (error) {
      setPlan(null);
      setPlanError(error instanceof Error ? error.message : "Unable to plan this movie day");
    } finally {
      setPlanning(false);
    }
  }

  function saveItinerary(itinerary: MovieDayItinerary): void {
    if (!response) return;
    const screenings = itinerary.showtime_ids
      .map((showtimeId) => screeningById.get(showtimeId))
      .filter((screening): screening is Screening => screening !== undefined);
    if (screenings.length !== itinerary.showtime_ids.length) {
      setPlanError("Unable to save this itinerary because one or more showings are unavailable.");
      return;
    }

    const nextKey = itineraryKey(itinerary);
    const existing = savedMoviePlanForDate(response.date);
    if (
      existing &&
      itineraryKey(existing.itinerary) !== nextKey &&
      !window.confirm(`Replace the saved movie plan for ${formatDate(response.date)}?`)
    ) {
      return;
    }

    saveMoviePlan({
      date: response.date,
      savedAt: new Date().toISOString(),
      itinerary: structuredClone(itinerary),
      screenings: structuredClone(screenings),
      runtimeOverrides: { ...runtimeOverrides },
    });
    setPlanError(null);
    setSavedItineraryKey(nextKey);
  }

  return (
    <section className="workspace movie-day-workspace" aria-labelledby="movie-day-heading">
      <div className="workspace-bar movie-day-bar">
        <div>
          <p className="eyebrow">TIME-WINDOW ROUTE PLANNER</p>
          <h1 id="movie-day-heading">Plan a movie day</h1>
        </div>
      </div>

      <MovieDayControlBar
        facets={facets}
        screenings={allScreenings}
        selectedMovies={selectedMovies}
        targetMovieCount={targetMovieCount}
        minimumTargetMovieCount={pinnedMovies.length}
        earliestTime={earliestTime}
        latestTime={latestTime}
        sortBy={sortBy}
        secondarySortBy={secondarySortBy}
        minimumBuffer={minimumBuffer}
        planning={planning}
        disabled={status !== "ready" || selectedMovies.length === 0}
        onFacetsChange={setFacets}
        onMovieSelectionChange={setMovieSelection}
        onTargetMovieCountChange={setTargetMovieCount}
        onEarliestTimeChange={setEarliestTime}
        onLatestTimeChange={setLatestTime}
        onSortByChange={changeSortBy}
        onSecondarySortByChange={setSecondarySortBy}
        onMinimumBufferChange={setMinimumBuffer}
        onPlan={() => void generate()}
      />

      {response && !homeConfigured ? (
        <div className="status-strip" role="status">
          <strong>Warning: no home address is set.</strong> “Home by” falls back to the final
          movie’s end time and does not include travel home.{" "}
          <a href="/settings">Set a home address</a> to include the return trip.
        </div>
      ) : null}

      <MoviePriorityEditor
        movies={rankedMovies}
        pinnedMovies={pinnedMovies}
        defaultRuntimeByMovie={defaultRuntimeByMovie}
        runtimeOverrides={runtimeOverrides}
        onMove={moveMovie}
        onTogglePinned={togglePinned}
        onRuntimeOverrideChange={setRuntimeOverride}
      />

      {status === "loading" ? (
        <div className="status-strip">Loading today’s screenings…</div>
      ) : null}
      {loadError || planError ? (
        <div className="status-strip error" role="alert">
          {loadError ?? planError}
        </div>
      ) : null}
      {response ? (
        <div className="planner-context">
          <div className="planner-facts">
            <span>{formatDate(response.date)}</span>
            <span>{selectedMovies.length} selected movies</span>
            <span>{targetCount || 0} to watch</span>
            <span>{pinnedMovies.length} pinned</span>
            <span>{Object.keys(runtimeOverrides).length} runtime overrides</span>
            <span>{eligibleScreenings.length} candidate showings</span>
            <span>{activeFilterCount} active Screening filters</span>
            <span>{activeShowingFilters} active showing filters</span>
            {bounds.endNextDay ? <span>End time is next day</span> : null}
          </div>
          <p>
            Rank selected movies from most to least wanted. With N selected movies, #1 is worth N
            points, #2 is worth N−1, and so on; pinned movies are mandatory. Manual runtimes replace
            fetched runtimes when calculating end times and itinerary feasibility. The solver may
            omit only unpinned movies when Watch is below the selected count, then globally ranks
            complete itineraries by the chosen primary objective and uses Secondary sort to break
            ties.
          </p>
        </div>
      ) : null}

      {plan ? (
        <>
          <div className="result-strip planner-results" aria-live="polite">
            <strong>{plan.total_itineraries}</strong> feasible {plan.target_movie_count}-movie
            itineraries
            <span>·</span>
            <span>{plan.eligible_showings} timed showings considered</span>
            <span>·</span>
            <span>{sortDescription(plan.sort_by, plan.secondary_sort_by)}</span>
            {plan.unplannable_showings ? (
              <>
                <span>·</span>
                <span>{plan.unplannable_showings} omitted for unknown preview/runtime</span>
              </>
            ) : null}
          </div>

          {plan.missing_required_movies.length ? (
            <p className="empty-state">
              Pinned movie{plan.missing_required_movies.length === 1 ? "" : "s"} with no eligible
              showing: {plan.missing_required_movies.join(", ")}. Change the showing/time filters or
              unpin the movie to find itineraries.
            </p>
          ) : plan.plannable_movie_count < plan.target_movie_count ? (
            <p className="empty-state">
              Only {plan.plannable_movie_count} selected movie
              {plan.plannable_movie_count === 1 ? " has" : "s have"} an eligible showing, but this
              day asks for {plan.target_movie_count}.
              {plan.missing_movies.length ? ` Unavailable: ${plan.missing_movies.join(", ")}.` : ""}
            </p>
          ) : plan.missing_movies.length ? (
            <div className="status-strip" role="status">
              Some selected movies have no eligible showing and can only be skipped:{" "}
              {plan.missing_movies.join(", ")}.
            </div>
          ) : null}

          {!plan.routing_available ? (
            <div className="status-strip error" role="status">
              Theater routing is unavailable; only same-theater connections could be evaluated.
            </div>
          ) : null}

          {plan.missing_required_movies.length === 0 &&
          plan.plannable_movie_count >= plan.target_movie_count &&
          plan.total_itineraries === 0 ? (
            <p className="empty-state">
              Enough movies have eligible showings, but no {plan.target_movie_count}-movie itinerary
              satisfies the current pinned-movie, time, travel, and transfer-buffer constraints.
            </p>
          ) : null}

          <div className="itinerary-list">
            {plan.itineraries.map((itinerary, index) => (
              <ItineraryCard
                key={itinerary.showtime_ids.join("|")}
                itinerary={itinerary}
                number={plan.offset + index + 1}
                screeningById={screeningById}
                runtimeOverrides={runtimeOverrides}
                saved={savedItineraryKey === itineraryKey(itinerary)}
                onSave={() => saveItinerary(itinerary)}
              />
            ))}
          </div>

          {plan.total_itineraries > PAGE_SIZE ? (
            <div className="planner-pagination">
              <button
                type="button"
                disabled={planning || plan.offset === 0}
                onClick={() => void generate(Math.max(0, plan.offset - PAGE_SIZE))}
              >
                Previous
              </button>
              <span>
                {plan.offset + 1}–{plan.offset + plan.itineraries.length} of{" "}
                {plan.total_itineraries}
              </span>
              <button
                type="button"
                disabled={planning || !plan.has_more}
                onClick={() => void generate(plan.offset + PAGE_SIZE)}
              >
                Next
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function ItineraryCard({
  itinerary,
  number,
  screeningById,
  runtimeOverrides,
  saved,
  onSave,
}: {
  itinerary: MovieDayItinerary;
  number: number;
  screeningById: Map<string, Screening>;
  runtimeOverrides: Readonly<Record<string, number>>;
  saved: boolean;
  onSave: () => void;
}) {
  const screenings = itinerary.showtime_ids
    .map((showtimeId) => screeningById.get(showtimeId))
    .filter((screening): screening is Screening => screening !== undefined);

  return (
    <article className="itinerary-card">
      <header>
        <div>
          <span className="option-number">OPTION {number}</span>
          <strong>
            {formatTime(itinerary.starts_at)}–{formatTime(itinerary.ends_at)}
          </strong>
          {itinerary.dropped_movies.length ? (
            <span className="dropped-movies">Skipped: {itinerary.dropped_movies.join(", ")}</span>
          ) : null}
        </div>
        <div className="itinerary-summary">
          <span>Want score {itinerary.want_score}</span>
          <span>{formatDuration(itinerary.elapsed_minutes)} total</span>
          <span>{itinerary.travel_minutes} min driving</span>
          <span>{itinerary.waiting_minutes} min free</span>
          <button type="button" onClick={onSave} aria-label={`Save option ${number} to Planner`}>
            {saved ? "Saved to Planner" : "Save to Planner"}
          </button>
        </div>
      </header>
      <ol>
        {screenings.map((screening, index) => {
          const leg = index > 0 ? itinerary.legs[index - 1] : undefined;
          const runtimeOverride = runtimeOverrides[screening.movie];
          const runtime = runtimeOverride ?? screening.runtime_minutes;
          return (
            <li key={screening.showtime_id}>
              {leg ? (
                <div className="transfer-line">
                  {leg.route_source_url ? (
                    <a href={leg.route_source_url} target="_blank" rel="noreferrer">
                      {leg.drive_minutes} min drive
                    </a>
                  ) : (
                    <span>Same theater</span>
                  )}
                  <span>{leg.gap_minutes - leg.drive_minutes} min spare</span>
                </div>
              ) : null}
              <div className="showing-line">
                <time>{formatTime(screening.actual_start ?? screening.advertised_start)}</time>
                <div>
                  <strong>{screening.movie}</strong>
                  <span>
                    {screening.theatre} · {screening.format} ·{" "}
                    {runtime === null ? "runtime unknown" : `${runtime} min`}
                    {runtimeOverride !== undefined ? " · manual" : ""}
                  </span>
                </div>
                <a href={screening.purchase_url} target="_blank" rel="noreferrer">
                  Tickets
                </a>
              </div>
            </li>
          );
        })}
      </ol>
    </article>
  );
}

function readMovieDayPreferences(): MovieDayPreferences {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(MOVIE_DAY_PREFERENCES_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ranking: [], pinned: [], runtimeOverrides: {} };
    }
    const value = parsed as {
      ranking?: unknown;
      pinned?: unknown;
      runtimeOverrides?: unknown;
    };
    return {
      ranking: stringArray(value.ranking),
      pinned: stringArray(value.pinned),
      runtimeOverrides: runtimeOverrideRecord(value.runtimeOverrides),
    };
  } catch {
    return { ranking: [], pinned: [], runtimeOverrides: {} };
  }
}

function persistMovieDayPreferences(preferences: MovieDayPreferences): void {
  if (
    preferences.ranking.length === 0 &&
    preferences.pinned.length === 0 &&
    Object.keys(preferences.runtimeOverrides).length === 0
  ) {
    localStorage.removeItem(MOVIE_DAY_PREFERENCES_KEY);
    return;
  }
  localStorage.setItem(MOVIE_DAY_PREFERENCES_KEY, JSON.stringify(preferences));
}

function reconcileMovieRanking(
  ranking: readonly string[],
  selectedMovies: readonly string[],
): string[] {
  const selected = new Set(selectedMovies);
  const retained = ranking.filter(
    (movie, index) => selected.has(movie) && ranking.indexOf(movie) === index,
  );
  const retainedSet = new Set(retained);
  return [...retained, ...selectedMovies.filter((movie) => !retainedSet.has(movie))];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.filter((item): item is string => typeof item === "string" && item.length > 0),
        ),
      ]
    : [];
}

function runtimeOverrideRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const overrides: Record<string, number> = {};
  for (const [movie, runtime] of Object.entries(value)) {
    if (
      movie.length > 0 &&
      typeof runtime === "number" &&
      Number.isInteger(runtime) &&
      runtime >= 1 &&
      runtime <= 600
    ) {
      overrides[movie] = runtime;
    }
  }
  return overrides;
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function defaultSecondarySort(sortBy: MovieDaySort): MovieDaySort {
  return sortBy === "elapsed" ? "driving" : "elapsed";
}

function sortDescription(sortBy: MovieDaySort, secondarySortBy: MovieDaySort): string {
  return `${sortLabel(sortBy)} first; ties by ${sortLabel(secondarySortBy).toLowerCase()}`;
}

function sortLabel(sortBy: MovieDaySort): string {
  if (sortBy === "driving") return "Minimum driving";
  if (sortBy === "want") return "Highest want score";
  return "Minimum time";
}

function itineraryKey(itinerary: MovieDayItinerary): string {
  return itinerary.showtime_ids.join("|");
}

function dayBounds(
  date: string,
  earliestTime: string,
  latestTime: string,
): { earliestStart: string | null; latestEnd: string | null; endNextDay: boolean } {
  const earliestStart = earliestTime ? `${date}T${earliestTime}:00` : null;
  const endNextDay = Boolean(earliestTime && latestTime && latestTime <= earliestTime);
  const latestEnd = latestTime ? `${endNextDay ? nextDate(date) : date}T${latestTime}:00` : null;
  return { earliestStart, latestEnd, endNextDay };
}

function nextDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(
    new Date(value),
  );
}

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours ? `${hours}h ${remainder}m` : `${remainder}m`;
}
