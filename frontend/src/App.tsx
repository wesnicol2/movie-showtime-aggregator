import { useEffect, useState } from "react";
import { MovieDayPage } from "./MovieDayPage";
import { MoviesPage } from "./MoviesPage";
import { ScreeningsPage } from "./ScreeningsPage";
import { SettingsPage } from "./SettingsPage";
import { useAppStore } from "./store";

type AppPath = "/" | "/movies" | "/plan" | "/settings";

function normalizePath(path: string): AppPath {
  if (path === "/movies") return "/movies";
  if (path === "/plan") return "/plan";
  if (path === "/settings") return "/settings";
  return "/";
}

export function App() {
  const [path, setPath] = useState(() => normalizePath(window.location.pathname));
  const [movieDayMounted, setMovieDayMounted] = useState(() => path === "/plan");
  const syncMovieSelection = useAppStore((state) => state.syncMovieSelection);

  useEffect(() => {
    const onPopState = () => {
      const nextPath = normalizePath(window.location.pathname);
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
    window.history.pushState({}, "", nextPath);
    setPath(nextPath);
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
            className={path === "/settings" ? "current" : ""}
            type="button"
            onClick={() => navigate("/settings")}
          >
            Settings
          </button>
        </nav>
      </header>
      <main className="app-main">
        {movieDayMounted ? (
          <div hidden={path !== "/plan"}>
            <MovieDayPage />
          </div>
        ) : null}
        {path === "/plan" ? null : path === "/movies" ? (
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
