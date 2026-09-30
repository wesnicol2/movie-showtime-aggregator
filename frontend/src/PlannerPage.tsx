import { useEffect, useMemo, useRef, useState } from "react";

import { fetchScreenings } from "./api";
import {
  deleteMoviePlan,
  PLANNER_STORAGE_KEY,
  PLANNER_UPDATED_EVENT,
  readSavedMoviePlans,
  type SavedMoviePlan,
} from "./planner";
import "./planner.css";
import { browserDate } from "./show-date";

const INITIAL_DAY_COUNT = 35;
const LOAD_MORE_DAY_COUNT = 28;

type VerificationState =
  | { status: "checking" }
  | { status: "valid" }
  | { status: "changed"; missingMovies: string[] }
  | { status: "unavailable" };

export function PlannerPage({ onPlanDate }: { onPlanDate: (date: string) => void }) {
  const today = browserDate();
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

  const planKey = plans
    .map((plan) => `${plan.date}:${plan.savedAt}:${plan.itinerary.showtime_ids.join("|")}`)
    .join("::");

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
  }, [planKey]);

  const dates = useMemo(
    () => Array.from({ length: daysShown }, (_, index) => addDays(today, index)),
    [daysShown, today],
  );
  const planByDate = useMemo(() => new Map(plans.map((plan) => [plan.date, plan])), [plans]);
  const futurePlans = plans.filter((plan) => plan.date >= today);
  const plannedMovies = futurePlans.reduce((total, plan) => total + plan.itinerary.movies.length, 0);

  useEffect(() => {
    if (!pendingJump) return;
    const element = document.getElementById(`planner-day-${pendingJump}`);
    if (!element) return;
    element.scrollIntoView({ behavior: "smooth", block: "start" });
    setPendingJump(null);
  }, [daysShown, pendingJump]);

  function jumpTo(date: string): void {
    if (!date) return;
    const normalized = date < today ? today : date;
    setJumpDate(normalized);
    const dayIndex = daysBetween(today, normalized);
    if (dayIndex >= daysShown) {
      setDaysShown(dayIndex + 14);
    }
    setPendingJump(normalized);
  }

  function removePlan(plan: SavedMoviePlan): void {
    if (!window.confirm(`Remove the saved movie plan for ${formatLongDate(plan.date)}?`)) return;
    deleteMoviePlan(plan.date);
  }

  return (
    <section className="workspace planner-workspace" aria-labelledby="planner-heading">
      <div className="workspace-bar planner-workspace-bar">
        <div>
          <p className="eyebrow">CONTINUOUS FUTURE TIMELINE</p>
          <h1 id="planner-heading">Movie planner</h1>
        </div>
        <div className="planner-jump-controls">
          <button type="button" onClick={() => jumpTo(today)}>
            Today
          </button>
          <label>
            <span>Jump to date</span>
            <input
              type="date"
              min={today}
              value={jumpDate}
              onChange={(event) => jumpTo(event.target.value)}
            />
          </label>
        </div>
      </div>

      <div className="result-strip planner-overview" aria-live="polite">
        <strong>{futurePlans.length}</strong> planned day{futurePlans.length === 1 ? "" : "s"}
        <span>·</span>
        <span>{plannedMovies} planned movies</span>
        <span>·</span>
        <span>Scroll down to move farther into the future</span>
      </div>

      <div className="planner-timeline">
        {dates.map((date, index) => {
          const plan = planByDate.get(date);
          const showMonth = index === 0 || monthKey(dates[index - 1] ?? "") !== monthKey(date);
          return (
            <div key={date}>
              {showMonth ? <MonthHeader date={date} /> : null}
              <DayRow
                date={date}
                plan={plan}
                verification={verificationByDate[date]}
                onPlanDate={onPlanDate}
                onDelete={removePlan}
              />
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

function DayRow({
  date,
  plan,
  verification,
  onPlanDate,
  onDelete,
}: {
  date: string;
  plan: SavedMoviePlan | undefined;
  verification: VerificationState | undefined;
  onPlanDate: (date: string) => void;
  onDelete: (plan: SavedMoviePlan) => void;
}) {
  return (
    <article
      id={`planner-day-${date}`}
      className={`planner-day ${plan ? "planned" : "empty"}`}
      data-date={date}
    >
      <header className="planner-day-header">
        <div>
          <strong>{formatDayLabel(date)}</strong>
          <span>{formatShortDate(date)}</span>
        </div>
        {plan ? (
          <div className="planner-day-actions">
            <button type="button" onClick={() => onPlanDate(date)}>
              Replan
            </button>
            <button className="danger-quiet" type="button" onClick={() => onDelete(plan)}>
              Remove
            </button>
          </div>
        ) : (
          <button className="planner-plan-day" type="button" onClick={() => onPlanDate(date)}>
            Plan this day →
          </button>
        )}
      </header>

      {plan ? <SavedPlanDetails plan={plan} verification={verification} /> : null}
    </article>
  );
}

function SavedPlanDetails({
  plan,
  verification,
}: {
  plan: SavedMoviePlan;
  verification: VerificationState | undefined;
}) {
  const screeningById = new Map(
    plan.screenings.map((screening) => [screening.showtime_id, screening]),
  );
  const screenings = plan.itinerary.showtime_ids
    .map((id) => screeningById.get(id))
    .filter((screening) => screening !== undefined);

  return (
    <div className="planner-saved-plan">
      <div className="planner-plan-summary">
        <strong>
          {formatTime(plan.itinerary.starts_at)}–{formatTime(plan.itinerary.ends_at)}
        </strong>
        <span>{plan.itinerary.movies.length} movies</span>
        <span>{formatDuration(plan.itinerary.elapsed_minutes)} total</span>
        <span>{plan.itinerary.travel_minutes} min driving</span>
        <VerificationBadge verification={verification} />
      </div>
      <ol className="planner-showing-list">
        {screenings.map((screening) => {
          const runtime = plan.runtimeOverrides[screening.movie] ?? screening.runtime_minutes;
          return (
            <li key={screening.showtime_id}>
              <time>{formatTime(screening.actual_start ?? screening.advertised_start)}</time>
              <div>
                <strong>{screening.movie}</strong>
                <span>
                  {screening.theatre} · {screening.format}
                  {runtime !== null ? ` · ${runtime} min` : ""}
                </span>
              </div>
              {screening.purchase_url ? (
                <a href={screening.purchase_url} target="_blank" rel="noreferrer">
                  Tickets
                </a>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function VerificationBadge({ verification }: { verification: VerificationState | undefined }) {
  if (!verification || verification.status === "checking") {
    return <span className="planner-verification muted">Checking showtimes…</span>;
  }
  if (verification.status === "valid") {
    return <span className="planner-verification valid">Showtimes still available</span>;
  }
  if (verification.status === "changed") {
    const detail = verification.missingMovies.length
      ? `: ${verification.missingMovies.join(", ")}`
      : "";
    return <span className="planner-verification warning">Showtime changed{detail}</span>;
  }
  return <span className="planner-verification muted">Could not verify showtimes</span>;
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

function parseLocalDate(value: string): Date {
  return new Date(`${value}T12:00:00`);
}

function toIsoDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthKey(date: string): string {
  return date.slice(0, 7);
}

function formatMonth(date: string): string {
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(
    parseLocalDate(date),
  );
}

function formatDayLabel(date: string): string {
  return new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(parseLocalDate(date));
}

function formatShortDate(date: string): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
    parseLocalDate(date),
  );
}

function formatLongDate(date: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(parseLocalDate(date));
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
