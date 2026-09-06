import { useEffect, useState } from "react";

import { MoviesPage } from "./MoviesPage";
import { ScreeningsPage } from "./ScreeningsPage";
import { SettingsPage } from "./SettingsPage";
import { useAppStore } from "./store";

function normalizePath(path: string): "/" | "/movies" | "/settings" {
  if (path === "/movies") return "/movies";
  if (path === "/settings") return "/settings";
  return "/";
}

export function App() {
  const [path, setPath] = useState(() => normalizePath(window.location.pathname));
  const syncMovieSelection = useAppStore((state) => state.syncMovieSelection);

  useEffect(() => {
    const onPopState = () => setPath(normalizePath(window.location.pathname));
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

  function navigate(nextPath: "/" | "/movies" | "/settings"): void {
    if (nextPath === path) return;
    window.history.pushState({}, "", nextPath);
    setPath(nextPath);
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <button className="brand" type="button" onClick={() => navigate("/")}>
          <span className="brand-mark" aria-hidden="true">▶</span>
          <span><strong>Showtime</strong><small>Movie decision workstation</small></span>
        </button>
        <nav className="app-nav" aria-label="Primary">
          <button className={path === "/" ? "current" : ""} type="button" onClick={() => navigate("/")}>Screenings</button>
          <button className={path === "/movies" ? "current" : ""} type="button" onClick={() => navigate("/movies")}>Movies</button>
          <button className={path === "/settings" ? "current" : ""} type="button" onClick={() => navigate("/settings")}>Settings</button>
        </nav>
      </header>
      <main className="app-main">
        {path === "/movies" ? <MoviesPage /> : path === "/settings" ? <SettingsPage /> : <ScreeningsPage />}
      </main>
    </div>
  );
}
