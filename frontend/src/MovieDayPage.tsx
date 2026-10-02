import { useEffect, useMemo, useState } from "react";

import { createMovieDayPlan } from "./api";
import { ExperienceDeviationChips } from "./components/ExperienceDeviationChips";
import { MovieDayControlBar } from "./components/MovieDayControlBar";
import { MoviePriorityEditor } from "./components/MoviePriorityEditor";
import "./movie-day.css";
import { readSavedMoviePlans, savedMoviePlanForDate, saveMoviePlan } from "./planner";
import {
  activeFacetCount,
  EMPTY_SCREENING_FACETS,
  matchesFacets,
  type ScreeningFacets,
} from "./screening-facets";
import { filterAndSort, isFilterActive } from "./screenings";
import { browserDate } from "./show-date";
import { useAppStore } from "./store";
import type {
  MovieDayItinerary,
  MovieDayPlanResponse,
  MovieDaySort,
  MovieDayTargetCount,
  Screening,
} from "./types";
import { useScreenings } from "./useScreenings";

const PAGE_SIZE = 25;
const MOVIE_DAY_PREFERENCES_KEY = "movie-showtime-aggregator.movie-day-preferences.v1";

interface MovieDayPreferences {
  ranking: string[];
  pinned: string[];
  runtimeOverrides: Record<string, number>;
}

interface Props {
  onBack: () => void;
  onLocked: () => void;
}

export function MovieDayPage({ onBack, onLocked }: Props) {
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
  const [targetMovieCount, setTargetMovieCount] = useState<MovieDayTargetCount | null>(1);
  const [earliestTime, setEarliestTime] = useState("");
  const [latestTime, setLatestTime] = useState("");
  const [sortBy, setSortBy] = useState<MovieDaySort>("want");
  const [secondarySortBy, setSecondarySortBy] = useState<MovieDaySort>("elapsed");
  const [moviePreferences, setMoviePreferences] =
    useState<MovieDayPreferences>(readMovieDayPreferences);
  const [plan, setPlan] = useState<MovieDayPlanResponse | null>(null);
  const [planSignature, setPlanSignature] = useState("");
  const [planError, setPlanError] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  const [savedItineraryKey, setSavedItineraryKey] = useState<string | null>(null);

  const responseDate = response?.date ?? "";
  const allScreenings = useMemo(() => response?.screenings ?? [], [response]);
  const savedPlans = useMemo(() => readSavedMoviePlans(), []);
  const currentPlanMovies = useMemo(
    () =>
      new Set(
        savedPlans.find((savedPlan) => savedPlan.date === responseDate)?.itinerary.movies ?? [],
      ),
    [responseDate, savedPlans],
  );
  const plannedElsewhere = useMemo(() => {
    const movies = new Set<string>();
    const today = browserDate();
    for (const savedPlan of savedPlans) {
      if (savedPlan.date < today || savedPlan.date === responseDate) continue;
      for (const movie of savedPlan.itinerary.movies) movies.add(movie);
    }
    return movies;
  }, [responseDate, savedPlans]);
  const availableSelectedMovies = useMemo(() => {
    const showingMovies = new Set(allScreenings.map((screening) => screening.movie));
    const candidates = [...new Set([...selectedMovies, ...currentPlanMovies])];
    return candidates.filter(
      (movie) =>
        showingMovies.has(movie) && (!plannedElsewhere.has(movie) || currentPlanMovies.has(movie)),
    );
  }, [allScreenings, currentPlanMovies, plannedElsewhere, selectedMovies]);
  const rankedMovies = useMemo(
    () => reconcileMovieRanking(moviePreferences.ranking, availableSelectedMovies),
    [availableSelectedMovies, moviePreferences.ranking],
  );
  const pinnedMovies = useMemo(() => {
    const selected = new Set(availableSelectedMovies);
    return moviePreferences.pinned.filter((movie) => selected.has(movie));
  }, [availableSelectedMovies, moviePreferences.pinned]);
  const runtimeOverrides = useMemo(() => {
    const overrides: Record<string, number> = {};
    for (const movie of availableSelectedMovies) {
      const runtime = moviePreferences.runtimeOverrides[movie];
      if (runtime !== undefined) overrides[movie] = runtime;
    }
    return overrides;
  }, [availableSelectedMovies, moviePreferences.runtimeOverrides]);
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
    const selected = new Set(availableSelectedMovies);
    return filterAndSort(allScreenings, filters, sort).filter(
      (screening) => selected.has(screening.movie) && matchesFacets(screening, facets),
    );
  }, [allScreenings, availableSelectedMovies, facets, filters, sort]);
  const screeningById = useMemo(
    () => new Map(allScreenings.map((screening) => [screening.showtime_id, screening])),
    [allScreenings],
  );
  const activeFilterCount = Object.values(filters).filter(isFilterActive).length;
  const activeShowingFilters = activeFacetCount(facets);
  const homeConfigured = response?.preferences.home_configured === true;
  const targetCount: MovieDayTargetCount = targetMovieCount ?? availableSelectedMovies.length;
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
    if (
      status === "ready" &&
      typeof targetMovieCount === "number" &&
      targetMovieCount > availableSelectedMovies.length
    ) {
      setTargetMovieCount(null);
    }
  }, [availableSelectedMovies.length, status, targetMovieCount]);

  useEffect(() => {
    if (typeof targetMovieCount === "number" && targetMovieCount < pinnedMovies.length) {
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
      const visible = ranking.filter((value) => availableSelectedMovies.includes(value));
      const index = visible.indexOf(movie);
      const destination = index + direction;
      if (index < 0 || destination < 0 || destination >= visible.length) return current;
      const nextVisible = [...visible];
      const currentMovie = nextVisible[index];
      const destinationMovie = nextVisible[destination];
      if (currentMovie === undefined || destinationMovie === undefined) return current;
      nextVisible[index] = destinationMovie;
      nextVisible[destination] = currentMovie;

      const visibleMovies = new Set(availableSelectedMovies);
      let visibleIndex = 0;
      const nextRanking = ranking.map((value) => {
        if (!visibleMovies.has(value)) return value;
        const replacement = nextVisible[visibleIndex];
        visibleIndex += 1;
        return replacement ?? value;
      });
      return { ...current, ranking: nextRanking };
    });
  }

  function togglePinned(movie: string): void {
    if (!availableSelectedMovies.includes(movie)) return;
    setMoviePreferences((current) => {
      const pinned = current.pinned.includes(movie)
        ? current.pinned.filter((value) => value !== movie)
        : [...current.pinned, movie];
      return { ...current, pinned };
    });
  }

  function removeMovie(movie: string): void {
    if (!selectedMovies.includes(movie)) return;
    if (!window.confirm(`Remove “${movie}” from your want list?`)) return;
    setMovieSelection(selectedMovies.filter((selected) => selected !== movie));
  }

  function setRuntimeOverride(movie: string, minutes: number | null): void {
    if (!availableSelectedMovies.includes(movie)) return;
    if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > 600)) return;
    setMoviePreferences((current) => {
      const next = { ...current.runtimeOverrides };
      if (minutes === null) delete next[movie];
      else next[movie] = minutes;
      return { ...current, runtimeOverrides: next };
    });
  }

  function setAvailableMovieSelection(movies: string[]): void {
    const mutableCandidates = new Set(availableSelectedMovies);
    const retainedWantedMovies = selectedMovies.filter((movie) => !mutableCandidates.has(movie));
    setMovieSelection([...retainedWantedMovies, ...movies]);
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
    onLocked();
  }

  return (
    <section className="workspace movie-day-workspace" aria-labelledby="movie-day-heading">
      <div className="workspace-bar movie-day-bar workflow-bar">
        <div>
          <p className="eyebrow">STEP 3 OF 3</p>
          <h1 id="movie-day-heading">Build your itinerary</h1>
          {response ? <p className="workflow-subtitle">{formatDate(response.date)}</p> : null}
        </div>
        <div className="workflow-actions">
          <button type="button" onClick={onBack}>
            Change movies
          </button>
          <strong>
            {availableSelectedMovies.length} candidate
            {availableSelectedMovies.length === 1 ? "" : "s"}
          </strong>
        </div>
      </div>

      <MovieDayControlBar
        facets={facets}
        screenings={allScreenings}
        selectedMovies={availableSelectedMovies}
        targetMovieCount={targetMovieCount}
        minimumTargetMovieCount={pinnedMovies.length}
        earliestTime={earliestTime}
        latestTime={latestTime}
        sortBy={sortBy}
        secondarySortBy={secondarySortBy}
        minimumBuffer={minimumBuffer}
        planning={planning}
        disabled={status !== "ready" || availableSelectedMovies.length === 0}
        onFacetsChange={setFacets}
        onMovieSelectionChange={setAvailableMovieSelection}
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

      <details className="movie-day-priority-advanced">
        <summary className="movie-day-detail-summary">Movie priorities & runtimes</summary>
        <MoviePriorityEditor
          movies={rankedMovies}
          pinnedMovies={pinnedMovies}
          defaultRuntimeByMovie={defaultRuntimeByMovie}
          runtimeOverrides={runtimeOverrides}
          onMove={moveMovie}
          onTogglePinned={togglePinned}
          onRemoveMovie={removeMovie}
          onRuntimeOverrideChange={setRuntimeOverride}
        />
      </details>

      {status === "loading" ? (
        <div className="status-strip">Loading today’s screenings…</div>
      ) : null}
      {loadError || planError ? (
        <div className="status-strip error" role="alert">
          {loadError ?? planError}
        </div>
      ) : null}
      {response ? (
        <details className="planner-context movie-day-explanation">
          <summary className="movie-day-detail-summary">How this plan is scored</summary>
          <div className="planner-facts">
            <span>{formatDate(response.date)}</span>
            <span>{availableSelectedMovies.length} candidate movies</span>
            <span>{targetCount === "any" ? "Any valid count" : `${targetCount} to watch`}</span>
            <span>{pinnedMovies.length} pinned</span>
            <span>{Object.keys(runtimeOverrides).length} runtime overrides</span>
            <span>{eligibleScreenings.length} candidate showings</span>
            <span>{activeFilterCount} active Screening filters</span>
            <span>{activeShowingFilters} active showing filters</span>
            {bounds.endNextDay ? <span>End time is next day</span> : null}
          </div>
          <p>
            Rank candidate movies from most to least wanted. With N candidate movies, #1 is worth N
            points, #2 is worth N−1, and so on; pinned movies are mandatory. Each positive screening
            experience deviation adds one want point and each negative deviation removes one. Manual
            runtimes replace fetched runtimes when calculating end times and itinerary feasibility.
            Watch “Any” mixes every feasible movie count under the same filters. Results are
            globally ranked by the chosen primary objective and use Secondary sort to break ties.
          </p>
        </details>
      ) : null}

      {plan ? (
        <>
          <div className="result-strip planner-results" aria-live="polite">
            <strong>{plan.total_itineraries}</strong>{" "}
            {plan.target_movie_count === "any"
              ? "feasible itineraries across all valid movie counts"
              : `feasible ${plan.target_movie_count}-movie itineraries`}
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
          ) : typeof plan.target_movie_count === "number" &&
            plan.plannable_movie_count < plan.target_movie_count ? (
            <p className="empty-state">
              Only {plan.plannable_movie_count} candidate movie
              {plan.plannable_movie_count === 1 ? " has" : "s have"} an eligible showing, but this
              day asks for {plan.target_movie_count}.
              {plan.missing_movies.length ? ` Unavailable: ${plan.missing_movies.join(", ")}.` : ""}
            </p>
          ) : plan.missing_movies.length ? (
            <div className="status-strip" role="status">
              Some candidate movies have no eligible showing and can only be skipped:{" "}
              {plan.missing_movies.join(", ")}.
            </div>
          ) : null}

          {!plan.routing_available ? (
            <div className="status-strip error" role="status">
              Theater routing is unavailable; only same-theater connections could be evaluated.
            </div>
          ) : null}

          {plan.missing_required_movies.length === 0 && plan.total_itineraries === 0 ? (
            <p className="empty-state">
              No itinerary satisfies the current pinned-movie, time, travel, and transfer-buffer
              constraints.
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
  const experienceAdjustment = itinerary.experience_adjustment ?? 0;

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
          <span>
            Want score {itinerary.want_score}
            {experienceAdjustment !== 0
              ? ` (${formatSignedScore(experienceAdjustment)} experience)`
              : ""}
          </span>
          <span>{formatDuration(itinerary.elapsed_minutes)} total</span>
          <span>Home at {itinerary.home_at ? formatTime(itinerary.home_at) : "not available"}</span>
          <span>{itinerary.travel_minutes} min driving</span>
          <span>{itinerary.waiting_minutes} min free</span>
          <button type="button" onClick={onSave} aria-label={`Lock in option ${number}`}>
            {saved ? "Locked in" : "Lock in itinerary"}
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
                    {screening.theatre} · {runtime === null ? "runtime unknown" : `${runtime} min`}
                    {runtimeOverride !== undefined ? " · manual" : ""}
                  </span>
                  <ExperienceDeviationChips deviations={screening.experience_deviations} />
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

function formatSignedScore(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}
