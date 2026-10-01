import { useEffect, useState } from "react";
import { ShowDateControl } from "./components/ShowDateControl";
import { MovieDayPage } from "./MovieDayPage";
import { MoviesPage } from "./MoviesPage";
import { PlannerPage } from "./PlannerPage";
import { ScreeningsPage } from "./ScreeningsPage";
import { SettingsPage } from "./SettingsPage";
import { useAppStore } from "./store";

type AppPath = "/" | "/movies" | "/plan" | "/planner" | "/settings";

function normalizeLocation(): AppPath {
  const path = window.location.pathname;
  if (path === "/movies") return "/movies";
  if (path === "/plan") {
    return new URLSearchParams(window.location.search).get("view") === "planner"
      ? "/planner"
      : "/plan";
  }
  if (path === "/settings") return "/settings";
  return "/";
}

function browserUrl(path: AppPath): string {
  return path === "/planner" ? "/plan?view=planner" : path;
}

export function App() {
  const [path, setPath] = useState(normalizeLocation);
  const [movieDayMounted, setMovieDayMounted] = useState(() => path === "/plan");
  const syncMovieSelection = useAppStore((state) => state.syncMovieSelection);
  const selectedMovies = useAppStore((state) => state.selectedMovies);
  const setMovieSelection = useAppStore((state) => state.setMovieSelection);
  const setSelectedDate = useAppStore((state) => state.setSelectedDate);

  useEffect(() => {
    const onPopState = () => {
      const nextPath = normalizeLocation();
      setPath(nextPath);
      if (nextPath === "/plan") setMovieDayMounted(true);
    };
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
    if (nextPath === "/plan") setMovieDayMounted(true);
    if (nextPath === path) return;
    window.history.pushState({}, "", browserUrl(nextPath));
    setPath(nextPath);
  }

  function planDate(date: string, movies: readonly string[] = []): void {
    if (movies.length > 0) {
      setMovieSelection([...selectedMovies, ...movies]);
    }
    setSelectedDate(date);
    navigate("/plan");
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
            <small>Movie decision workstation</small>
          </span>
        </button>
        <div className="app-header-tools">
          {path === "/planner" ? null : <ShowDateControl />}
          <nav className="app-nav" aria-label="Primary">
            <button
              className={path === "/" ? "current" : ""}
              type="button"
              onClick={() => navigate("/")}
            >
              Screenings
            </button>
            <button
              className={path === "/movies" ? "current" : ""}
              type="button"
              onClick={() => navigate("/movies")}
            >
              Movies
            </button>
            <button
              className={path === "/plan" ? "current" : ""}
              type="button"
              onClick={() => navigate("/plan")}
            >
              Movie Day
            </button>
            <button
              className={path === "/planner" ? "current" : ""}
              type="button"
              onClick={() => navigate("/planner")}
            >
              Planner
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
        {movieDayMounted ? (
          <div hidden={path !== "/plan"}>
            <MovieDayPage />
          </div>
        ) : null}
        {path === "/plan" ? null : path === "/planner" ? (
          <PlannerPage onPlanDate={planDate} />
        ) : path === "/movies" ? (
          <MoviesPage />
        ) : path === "/settings" ? (
          <SettingsPage />
        ) : (
          <ScreeningsPage />
        )}
      </main>
    </div>
  );
}
