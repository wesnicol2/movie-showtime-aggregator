import { useEffect, useMemo, useState } from "react";

import { createMovieDayPlan } from "./api";
import "./movie-day.css";
import { filterAndSort, isFilterActive } from "./screenings";
import { useAppStore } from "./store";
import type { MovieDayItinerary, MovieDayPlanResponse, Screening } from "./types";
import { useScreenings } from "./useScreenings";

const PAGE_SIZE = 25;

export function MovieDayPage() {
  useScreenings();
  const response = useAppStore((state) => state.response);
  const status = useAppStore((state) => state.status);
  const loadError = useAppStore((state) => state.error);
  const filters = useAppStore((state) => state.filters);
  const sort = useAppStore((state) => state.sort);
  const selectedMovies = useAppStore((state) => state.selectedMovies);
  const [minimumBuffer, setMinimumBuffer] = useState(0);
  const [plan, setPlan] = useState<MovieDayPlanResponse | null>(null);
  const [planSignature, setPlanSignature] = useState("");
  const [planError, setPlanError] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);

  const eligibleScreenings = useMemo(() => {
    const selected = new Set(selectedMovies);
    return filterAndSort(response?.screenings ?? [], filters, sort).filter((screening) =>
      selected.has(screening.movie),
    );
  }, [filters, response, selectedMovies, sort]);
  const screeningById = useMemo(
    () =>
      new Map((response?.screenings ?? []).map((screening) => [screening.showtime_id, screening])),
    [response],
  );
  const activeFilterCount = Object.values(filters).filter(isFilterActive).length;
  const inputSignature = `${minimumBuffer}|${selectedMovies.join("|")}|${eligibleScreenings
    .map((screening) => screening.showtime_id)
    .join("|")}`;

  useEffect(() => {
    if (plan && planSignature !== inputSignature) setPlan(null);
  }, [inputSignature, plan, planSignature]);

  async function generate(offset = 0): Promise<void> {
    if (!response || selectedMovies.length === 0) return;
    setPlanning(true);
    setPlanError(null);
    try {
      const nextPlan = await createMovieDayPlan({
        date: response.date,
        movies: selectedMovies,
        showtime_ids: eligibleScreenings.map((screening) => screening.showtime_id),
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

  return (
    <section className="workspace movie-day-workspace" aria-labelledby="movie-day-heading">
      <div className="workspace-bar movie-day-bar">
        <div>
          <p className="eyebrow">TIME-WINDOW ROUTE PLANNER</p>
          <h1 id="movie-day-heading">Plan a movie day</h1>
        </div>
        <div className="workspace-actions">
          <label className="buffer-control">
            <span>Extra transfer buffer</span>
            <span>
              <input
                aria-label="Extra transfer buffer"
                type="number"
                min="0"
                max="180"
                value={minimumBuffer}
                onChange={(event) =>
                  setMinimumBuffer(Math.max(0, Math.min(180, Number(event.target.value) || 0)))
                }
              />
              min
            </span>
          </label>
          <button
            className="primary-action"
            type="button"
            disabled={planning || status !== "ready" || selectedMovies.length === 0}
            onClick={() => void generate()}
          >
            {planning ? "Planning…" : "Find combinations"}
          </button>
        </div>
      </div>

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
          <div>
            <span className="context-label">Selected movies</span>
            {selectedMovies.length ? (
              <div className="movie-chips">
                {selectedMovies.map((movie) => (
                  <span key={movie}>{movie}</span>
                ))}
              </div>
            ) : (
              <p>Select movies on the Movies page first.</p>
            )}
          </div>
          <div className="planner-facts">
            <span>{formatDate(response.date)}</span>
            <span>{eligibleScreenings.length} eligible showings</span>
            <span>{activeFilterCount} active Screening filters</span>
          </div>
          <p>
            The current Screening column filters determine which showings may be used. Actual start,
            runtime, and static theater-to-theater drive time determine whether each connection
            fits.
          </p>
        </div>
      ) : null}

      {plan ? (
        <>
          <div className="result-strip planner-results" aria-live="polite">
            <strong>{plan.total_itineraries}</strong> feasible combinations
            <span>·</span>
            <span>{plan.eligible_showings} timed showings considered</span>
            {plan.unplannable_showings ? (
              <>
                <span>·</span>
                <span>{plan.unplannable_showings} omitted for unknown preview/runtime</span>
              </>
            ) : null}
          </div>
          {plan.missing_movies.length ? (
            <p className="empty-state">
              No plannable showing remains for {plan.missing_movies.join(", ")}. Check its active
              filters, preview setting, and runtime.
            </p>
          ) : null}
          {!plan.routing_available ? (
            <div className="status-strip error" role="status">
              Theater routing is unavailable; only same-theater connections could be evaluated.
            </div>
          ) : null}
          {!plan.missing_movies.length && plan.total_itineraries === 0 ? (
            <p className="empty-state">
              Every selected movie has a timed showing, but none can be connected with the current
              drive-time and transfer-buffer constraints.
            </p>
          ) : null}
          <div className="itinerary-list">
            {plan.itineraries.map((itinerary, index) => (
              <ItineraryCard
                key={itinerary.showtime_ids.join("|")}
                itinerary={itinerary}
                number={plan.offset + index + 1}
                screeningById={screeningById}
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
}: {
  itinerary: MovieDayItinerary;
  number: number;
  screeningById: Map<string, Screening>;
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
        </div>
        <div className="itinerary-summary">
          <span>{formatDuration(itinerary.elapsed_minutes)} total</span>
          <span>{itinerary.travel_minutes} min driving</span>
          <span>{itinerary.waiting_minutes} min free</span>
        </div>
      </header>
      <ol>
        {screenings.map((screening, index) => {
          const leg = index > 0 ? itinerary.legs[index - 1] : undefined;
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
                    {screening.theatre} · {screening.format} · {screening.runtime_minutes} min
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
