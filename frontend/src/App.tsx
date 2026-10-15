import { useEffect, useState } from "react";
import { ShowDateControl } from "./components/ShowDateControl";
import { MovieDayPage } from "./MovieDayPage";
import { MoviesPage } from "./MoviesPage";
import { PlannerPage } from "./PlannerPage";
import { ScreeningsPage } from "./ScreeningsPage";
import { SettingsPage } from "./SettingsPage";
import { useAppStore } from "./store";
import type { BuildInfo, HealthResponse } from "./types";
import { WatchlistPage } from "./WatchlistPage";

type AppPath = "/" | "/movies" | "/plan" | "/showtimes" | "/settings" | "/watchlist";

function buildTimestamp(value: string | null): string {
  if (!value) return "unknown";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString().replace("T", " ").replace(".000Z", " UTC");
}

function normalizeLocation(): AppPath {
  const path = window.location.pathname;
  if (path === "/movies") return "/movies";
  if (path === "/plan") {
    return new URLSearchParams(window.location.search).get("view") === "planner" ? "/" : "/plan";
  }
  if (path === "/planner") return "/";
  if (path === "/showtimes") return "/showtimes";
  if (path === "/settings") return "/settings";
  if (path === "/watchlist") return "/watchlist";
  return "/";
}

export function App() {
  const [path, setPath] = useState(normalizeLocation);
  const [calendarFocusDate, setCalendarFocusDate] = useState<string | null>(null);
  const [build, setBuild] = useState<BuildInfo | null>(null);
  const syncMovieSelection = useAppStore((state) => state.syncMovieSelection);
  const selectedDate = useAppStore((state) => state.selectedDate);
  const setSelectedDate = useAppStore((state) => state.setSelectedDate);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/health", { signal: controller.signal, cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("Build status unavailable");
        return response.json() as Promise<HealthResponse>;
      })
      .then((payload) => {
        if (!controller.signal.aborted) setBuild(payload.build ?? null);
      })
      .catch(() => {
        if (!controller.signal.aborted) setBuild(null);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const onPopState = () => setPath(normalizeLocation());
    const onStorage = (event: StorageEvent) => {
      if (
        event.key === "movie-showtime-aggregator.selected-movies.v1" ||
        event.key === "movie-showtime-aggregator.watched-movies.v1"
      )
        syncMovieSelection();
    };
    window.addEventListener("popstate", onPopState);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("storage", onStorage);
    };
  }, [syncMovieSelection]);

  function navigate(nextPath: AppPath): void {
    if (nextPath === path) return;
    window.history.pushState({}, "", nextPath);
    setPath(nextPath);
  }

  function chooseDate(date: string): void {
    setSelectedDate(date);
    setCalendarFocusDate(date);
    navigate("/movies");
  }

  function lockItinerary(): void {
    setCalendarFocusDate(selectedDate);
    navigate("/");
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <button className="brand" type="button" onClick={() => navigate("/")}>
          <span className="brand-mark" aria-hidden="true">
            ▶
          </span>
          <span>
            <strong>Showtime</strong>
            <small>Plan your movie week</small>
          </span>
        </button>
        <div className="app-header-tools">
          {path === "/showtimes" ? <ShowDateControl /> : null}
          <nav className="app-nav app-nav-secondary" aria-label="Primary">
            <button
              className={path === "/" ? "current" : ""}
              type="button"
              onClick={() => navigate("/")}
            >
              Calendar
            </button>
            <button
              className={path === "/watchlist" ? "current" : ""}
              type="button"
              onClick={() => navigate("/watchlist")}
            >
              Watchlist
            </button>
            <button
              className={path === "/showtimes" ? "current" : ""}
              type="button"
              onClick={() => navigate("/showtimes")}
            >
              Showtimes
            </button>
            <button
              className={path === "/settings" ? "current" : ""}
              type="button"
              onClick={() => navigate("/settings")}
            >
              Settings
            </button>
          </nav>
        </div>
      </header>
      <main className="app-main">
        {path === "/" ? (
          <PlannerPage onChooseDate={chooseDate} focusDate={calendarFocusDate} />
        ) : path === "/movies" ? (
          <MoviesPage onBack={() => navigate("/")} onContinue={() => navigate("/plan")} />
        ) : path === "/plan" ? (
          <MovieDayPage onBack={() => navigate("/movies")} onLocked={lockItinerary} />
        ) : path === "/watchlist" ? (
          <WatchlistPage onBrowse={() => navigate("/movies")} onPlan={() => navigate("/")} />
        ) : path === "/settings" ? (
          <SettingsPage />
        ) : (
          <ScreeningsPage />
        )}
      </main>
      {build?.image_tag === "test" ? (
        <aside
          className="test-build-stamp"
          aria-label="Test build"
          title={`Commit ${build.commit} · Commit updated ${build.commit_at ?? "unknown"} · Image built ${build.built_at ?? "unknown"}`}
        >
          <strong>TEST</strong>
          <code>{build.commit_short}</code>
          <span>Updated {buildTimestamp(build.commit_at)}</span>
        </aside>
      ) : null}
    </div>
  );
}
