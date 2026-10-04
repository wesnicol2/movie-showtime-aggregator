import { Fragment, useEffect, useMemo, useRef, useState } from "react";

import { fetchScreenings } from "./api";
import { ExperienceDeviationChips } from "./components/ExperienceDeviationChips";
import {
  deleteMoviePlan,
  PLANNER_STORAGE_KEY,
  PLANNER_UPDATED_EVENT,
  readSavedMoviePlans,
  type SavedMoviePlan,
} from "./planner";
import "./planner.css";
import { browserDate } from "./show-date";
import { useAppStore } from "./store";
import type { MovieDayLeg, Screening } from "./types";

const INITIAL_DAY_COUNT = 35;
const LOAD_MORE_DAY_COUNT = 28;
const TIMELINE_PX_PER_MINUTE = 0.8;
const TIMELINE_MAX_SEGMENT_PX = 72;

type VerificationState =
  | { status: "checking" }
  | { status: "valid" }
  | { status: "changed"; missingMovies: string[] }
  | { status: "unavailable" };

type ChooseDateHandler = (date: string) => void;

export function PlannerPage({
  onChooseDate,
  focusDate,
}: {
  onChooseDate: ChooseDateHandler;
  focusDate?: string | null;
}) {
  const today = browserDate();
  const wantedMovies = useAppStore((state) => state.selectedMovies);
  const [plans, setPlans] = useState(readSavedMoviePlans);
  const [daysShown, setDaysShown] = useState(INITIAL_DAY_COUNT);
  const [jumpDate, setJumpDate] = useState(today);
  const [pendingJump, setPendingJump] = useState<string | null>(null);
  const [verificationByDate, setVerificationByDate] = useState<Record<string, VerificationState>>(
    {},
  );
  const endMarkerRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    const marker = endMarkerRef.current;
    if (!marker) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setDaysShown((current) => current + LOAD_MORE_DAY_COUNT);
        }
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(marker);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setVerificationByDate(
      Object.fromEntries(plans.map((plan) => [plan.date, { status: "checking" } as const])),
    );

    for (const plan of plans) {
      void fetchScreenings(plan.date, false)
        .then((response) => {
          if (cancelled) return;
          const currentIds = new Set(response.screenings.map((screening) => screening.showtime_id));
          const missingIds = plan.itinerary.showtime_ids.filter((id) => !currentIds.has(id));
          if (missingIds.length === 0) {
            setVerificationByDate((current) => ({
              ...current,
              [plan.date]: { status: "valid" },
            }));
            return;
          }
          const missingSet = new Set(missingIds);
          const missingMovies = plan.screenings
            .filter((screening) => missingSet.has(screening.showtime_id))
            .map((screening) => screening.movie);
          setVerificationByDate((current) => ({
            ...current,
            [plan.date]: {
              status: "changed",
              missingMovies: [...new Set(missingMovies)],
            },
          }));
        })
        .catch(() => {
          if (cancelled) return;
          setVerificationByDate((current) => ({
            ...current,
            [plan.date]: { status: "unavailable" },
          }));
        });
    }

    return () => {
      cancelled = true;
    };
  }, [plans]);

  const dates = useMemo(
    () => Array.from({ length: daysShown }, (_, index) => addDays(today, index)),
    [daysShown, today],
  );
  const planByDate = useMemo(() => new Map(plans.map((plan) => [plan.date, plan])), [plans]);
  const futurePlans = useMemo(() => plans.filter((plan) => plan.date >= today), [plans, today]);
  const plannedMovieCount = futurePlans.reduce(
    (total, plan) => total + plan.itinerary.movies.length,
    0,
  );
  const plannedMovieNames = useMemo(
    () => new Set(futurePlans.flatMap((plan) => plan.itinerary.movies)),
    [futurePlans],
  );
  const unplannedWantedMovies = wantedMovies.filter((movie) => !plannedMovieNames.has(movie));

  useEffect(() => {
    if (!focusDate) return;
    const normalized = focusDate < today ? today : focusDate;
    setJumpDate(normalized);
    const dayIndex = daysBetween(today, normalized);
    setDaysShown((current) => Math.max(current, dayIndex + 14));
    setPendingJump(normalized);
  }, [focusDate, today]);

  useEffect(() => {
    if (!pendingJump) return;
    const element = document.getElementById(`planner-day-${pendingJump}`);
    if (!element) return;
    element.scrollIntoView({ behavior: "smooth", block: "start" });
    setPendingJump(null);
  }, [pendingJump]);

  function jumpTo(date: string): void {
    if (!date) return;
    const normalized = date < today ? today : date;
    setJumpDate(normalized);
    const dayIndex = daysBetween(today, normalized);
    if (dayIndex >= daysShown) setDaysShown(dayIndex + 14);
    setPendingJump(normalized);
  }

  function removePlan(plan: SavedMoviePlan): void {
    if (!window.confirm(`Remove the saved movie plan for ${formatLongDate(plan.date)}?`)) return;
    deleteMoviePlan(plan.date);
  }

  return (
    <section className="workspace planner-workspace" aria-labelledby="planner-heading">
      <div className="workspace-bar planner-workspace-bar">
        <div className="planner-heading-group">
          <p className="eyebrow">YOUR MOVIE CALENDAR</p>
          <h1 id="planner-heading">Plan your movie week</h1>
          <p className="planner-heading-copy">See the shape of each movie day before you commit to it.</p>
        </div>
        <div className="planner-jump-controls">
          <button type="button" onClick={() => jumpTo(today)}>Today</button>
          <label>
            <span className="planner-jump-label">Jump to date</span>
            <input type="date" min={today} value={jumpDate} onChange={(event) => jumpTo(event.target.value)} />
          </label>
        </div>
      </div>

      <div className="result-strip planner-overview" aria-live="polite">
        <strong>{futurePlans.length}</strong> planned day{futurePlans.length === 1 ? "" : "s"}
        <span>·</span>
        <span>{plannedMovieCount} planned movies</span>
        {unplannedWantedMovies.length > 0 ? (
          <>
            <span>·</span>
            <details className="planner-unplanned-details">
              <summary>{unplannedWantedMovies.length} wanted movie{unplannedWantedMovies.length === 1 ? "" : "s"} still unplanned</summary>
              <div className="planner-unplanned-popover">{unplannedWantedMovies.join(", ")}</div>
            </details>
          </>
        ) : wantedMovies.length > 0 ? (
          <>
            <span>·</span>
            <span className="planner-all-planned">All wanted movies are planned</span>
          </>
        ) : null}
      </div>

      <div className="planner-timeline">
        {dates.map((date, index) => {
          const plan = planByDate.get(date);
          const showMonth = index === 0 || monthKey(dates[index - 1] ?? "") !== monthKey(date);
          return (
            <div key={date}>
              {showMonth ? <MonthHeader date={date} /> : null}
              <DayRow date={date} plan={plan} verification={verificationByDate[date]} onChooseDate={onChooseDate} onDelete={removePlan} />
            </div>
          );
        })}
        <div ref={endMarkerRef} className="planner-load-marker" aria-hidden="true" />
      </div>
    </section>
  );
}

function MonthHeader({ date }: { date: string }) {
  return <h2 className="planner-month-header">{formatMonth(date)}</h2>;
}

function DayRow({ date, plan, verification, onChooseDate, onDelete }: {
  date: string;
  plan: SavedMoviePlan | undefined;
  verification: VerificationState | undefined;
  onChooseDate: ChooseDateHandler;
  onDelete: (plan: SavedMoviePlan) => void;
}) {
  return (
    <article id={`planner-day-${date}`} className={`planner-day ${plan ? "planned" : "empty"}`} data-date={date}>
      <header className="planner-day-header">
        <div className="planner-day-title">
          <strong>{formatDayLabel(date)}</strong>
          <span>{formatShortDate(date)}</span>
        </div>
        {plan ? (
          <div className="planner-day-actions">
            <button type="button" onClick={() => onChooseDate(date)}>Edit day</button>
            <button className="danger-quiet" type="button" onClick={() => onDelete(plan)}>Remove</button>
          </div>
        ) : (
          <button className="planner-plan-day" type="button" onClick={() => onChooseDate(date)}>Choose movies →</button>
        )}
      </header>
      {plan ? <SavedPlanDetails plan={plan} verification={verification} /> : null}
    </article>
  );
}

function SavedPlanDetails({ plan, verification }: { plan: SavedMoviePlan; verification: VerificationState | undefined }) {
  const screeningById = new Map(plan.screenings.map((screening) => [screening.showtime_id, screening]));
  const screenings = plan.itinerary.showtime_ids
    .map((id) => screeningById.get(id))
    .filter((screening): screening is Screening => screening !== undefined);
  const leaveHome = screenings[0]?.leave_home;
  const homeAt = plan.itinerary.home_at ?? screenings[screenings.length - 1]?.home_arrival ?? null;
  const knownTicketTotal = screenings.length > 0 && screenings.every((screening) => screening.ticket_price !== null)
    ? screenings.reduce((total, screening) => total + (screening.ticket_price ?? 0), 0)
    : null;

  return (
    <div className="planner-saved-plan">
      <div className="planner-plan-summary">
        <div className="planner-plan-primary">
          <strong className="planner-plan-time">{formatTime(leaveHome ?? plan.itinerary.starts_at)}–{formatTime(homeAt ?? plan.itinerary.ends_at)}</strong>
          <span>{leaveHome && homeAt ? "door to door" : "movie window"}</span>
        </div>
        <div className="planner-plan-metrics">
          <span><strong>{plan.itinerary.movies.length}</strong> movies</span>
          <span><strong>{formatDuration(plan.itinerary.movie_minutes)}</strong> movies</span>
          <span><strong>{formatDuration(plan.itinerary.waiting_minutes)}</strong> free</span>
          <span><strong>{formatDuration(plan.itinerary.travel_minutes)}</strong> driving</span>
          <span><strong>{formatDuration(plan.itinerary.elapsed_minutes)}</strong> total</span>
          {knownTicketTotal !== null ? <span><strong>{formatCurrency(knownTicketTotal)}</strong> tickets</span> : null}
        </div>
        <VerificationBadge verification={verification} />
      </div>

      <ol className="planner-showing-list">
        {screenings.map((screening, index) => {
          const runtime = plan.runtimeOverrides[screening.movie] ?? screening.runtime_minutes;
          const leg = index > 0 ? plan.itinerary.legs[index - 1] : undefined;
          return (
            <Fragment key={screening.showtime_id}>
              {leg ? <TimelineGap leg={leg} /> : null}
              <li className="planner-showing">
                <time>{formatTime(screening.actual_start ?? screening.advertised_start)}</time>
                <div className="planner-showing-copy">
                  <strong>{screening.movie}</strong>
                  <span>{screening.theatre}{runtime !== null ? ` · ${runtime} min` : ""}</span>
                  <ExperienceDeviationChips deviations={screening.experience_deviations} />
                </div>
                <div className="planner-ticket-block">
                  <strong className={screening.ticket_price === null ? "unknown" : ""}>{ticketPriceLabel(screening)}</strong>
                  {screening.purchase_url ? <a href={screening.purchase_url} target="_blank" rel="noreferrer">Tickets</a> : null}
                </div>
              </li>
            </Fragment>
          );
        })}
      </ol>
    </div>
  );
}

function TimelineGap({ leg }: { leg: MovieDayLeg }) {
  const freeMinutes = Math.max(0, leg.gap_minutes - leg.drive_minutes);
  return (
    <li className="planner-gap" aria-label={`${leg.drive_minutes} minutes driving, ${freeMinutes} minutes free`}>
      <div className="planner-gap-rail" aria-hidden="true">
        {leg.drive_minutes > 0 ? (
          <div className={`planner-gap-segment drive ${isCompressed(leg.drive_minutes) ? "compressed" : ""}`} style={{ height: timelineHeight(leg.drive_minutes) }} />
        ) : null}
        {freeMinutes > 0 ? (
          <div className={`planner-gap-segment free ${isCompressed(freeMinutes) ? "compressed" : ""}`} style={{ height: timelineHeight(freeMinutes) }} />
        ) : null}
      </div>
      <div className="planner-gap-labels">
        {leg.drive_minutes > 0 ? <span className="drive-label">{formatDuration(leg.drive_minutes)} driving</span> : <span>Same theater</span>}
        {freeMinutes > 0 ? <span>{formatDuration(freeMinutes)} free</span> : null}
      </div>
    </li>
  );
}

function VerificationBadge({ verification }: { verification: VerificationState | undefined }) {
  if (!verification || verification.status === "checking") return <span className="planner-verification muted">Checking showtimes…</span>;
  if (verification.status === "valid") return <span className="planner-verification valid">Showtimes still available</span>;
  if (verification.status === "changed") {
    const detail = verification.missingMovies.length ? `: ${verification.missingMovies.join(", ")}` : "";
    return <span className="planner-verification warning">Showtime changed{detail}</span>;
  }
  return <span className="planner-verification muted">Could not verify showtimes</span>;
}

function ticketPriceLabel(screening: Screening): string {
  if (screening.ticket_price === null) return "Price unknown";
  if (screening.ticket_price === 0 && screening.chain.toLowerCase().includes("amc") && screening.amc_a_list_eligible) return "A-List $0";
  return formatCurrency(screening.ticket_price);
}

function timelineHeight(minutes: number): number {
  if (minutes <= 0) return 0;
  return Math.min(TIMELINE_MAX_SEGMENT_PX, Math.max(10, minutes * TIMELINE_PX_PER_MINUTE));
}

function isCompressed(minutes: number): boolean {
  return minutes * TIMELINE_PX_PER_MINUTE > TIMELINE_MAX_SEGMENT_PX;
}

function addDays(date: string, days: number): string {
  const value = parseLocalDate(date);
  value.setDate(value.getDate() + days);
  return toIsoDate(value);
}

function daysBetween(start: string, end: string): number {
  const milliseconds = parseLocalDate(end).getTime() - parseLocalDate(start).getTime();
  return Math.max(0, Math.round(milliseconds / 86_400_000));
}

function parseLocalDate(value: string): Date { return new Date(`${value}T12:00:00`); }
function toIsoDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function monthKey(date: string): string { return date.slice(0, 7); }
function formatMonth(date: string): string { return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(parseLocalDate(date)); }
function formatDayLabel(date: string): string { return new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(parseLocalDate(date)); }
function formatShortDate(date: string): string { return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(parseLocalDate(date)); }
function formatLongDate(date: string): string {
  return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(parseLocalDate(date));
}
function formatTime(value: string): string {
  const parsed = new Date(value);
  return parsed.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) return `${remainder}m`;
  return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
}
function formatCurrency(value: number): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(value);
}
