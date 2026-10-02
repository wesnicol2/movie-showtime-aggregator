import { useEffect, useState } from "react";
import { ShowDateControl } from "./components/ShowDateControl";
import { MovieDayPage } from "./MovieDayPage";
import { MoviesPage } from "./MoviesPage";
import { PlannerPage } from "./PlannerPage";
import { ScreeningsPage } from "./ScreeningsPage";
import { SettingsPage } from "./SettingsPage";
import { useAppStore } from "./store";

type AppPath = "/" | "/movies" | "/plan" | "/showtimes" | "/settings";

function normalizeLocation(): AppPath {
  const path = window.location.pathname;
  if (path === "/movies") return "/movies";
  if (path === "/plan") {
    return new URLSearchParams(window.location.search).get("view") === "planner" ? "/" : "/plan";
  }
  if (path === "/planner") return "/";
  if (path === "/showtimes") return "/showtimes";
  if (path === "/settings") return "/settings";
  return "/";
}

export function App() {
  const [path, setPath] = useState(normalizeLocation);
  const [calendarFocusDate, setCalendarFocusDate] = useState<string | null>(null);
  const syncMovieSelection = useAppStore((state) => state.syncMovieSelection);
  const selectedDate = useAppStore((state) => state.selectedDate);
  const setSelectedDate = useAppStore((state) => state.setSelectedDate);

  useEffect(() => {
    const onPopState = () => setPath(normalizeLocation());
    const onStorage = (event: StorageEvent) => {
      if (event.key === "movie-showtime-aggregator.selected-movies.v1") syncMovieSelection();
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
        ) : path === "/settings" ? (
          <SettingsPage />
        ) : (
          <ScreeningsPage />
        )}
      </main>
    </div>
  );
}
