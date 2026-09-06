import { useMemo, useState } from "react";

import { useAppStore } from "./store";
import type { Screening } from "./types";
import { useScreenings } from "./useScreenings";

type MovieSort = "title" | "imdb_rating" | "rotten_tomatoes_score" | "metacritic_score";

export function MoviesPage() {
  useScreenings();
  const response = useAppStore((state) => state.response);
  const status = useAppStore((state) => state.status);
  const error = useAppStore((state) => state.error);
  const selectedMovies = useAppStore((state) => state.selectedMovies);
  const toggleMovie = useAppStore((state) => state.toggleMovie);
  const [sort, setSort] = useState<MovieSort>("title");

  const movies = useMemo(() => {
    const unique = new Map<string, Screening>();
    for (const screening of response?.screenings ?? []) {
      const existing = unique.get(screening.movie);
      if (!existing || (!existing.poster_url && screening.poster_url))
        unique.set(screening.movie, screening);
    }
    return [...unique.values()].sort((left, right) => {
      if (sort === "title") {
        return left.movie.localeCompare(right.movie, undefined, {
          numeric: true,
          sensitivity: "base",
        });
      }
      const leftValue = left[sort];
      const rightValue = right[sort];
      if (leftValue === null && rightValue === null) return left.movie.localeCompare(right.movie);
      if (leftValue === null) return 1;
      if (rightValue === null) return -1;
      return Number(rightValue) - Number(leftValue) || left.movie.localeCompare(right.movie);
    });
  }, [response, sort]);

  return (
    <section className="workspace movie-workspace" aria-labelledby="movies-heading">
      <div className="workspace-bar movie-bar">
        <div>
          <p className="eyebrow">NOW PLAYING</p>
          <h1 id="movies-heading">Choose movies</h1>
        </div>
        <div className="workspace-actions">
          <label className="select-label">
            <span className="sr-only">Sort movies</span>
            <select value={sort} onChange={(event) => setSort(event.target.value as MovieSort)}>
              <option value="title">Title</option>
              <option value="imdb_rating">IMDb rating</option>
              <option value="rotten_tomatoes_score">Rotten Tomatoes</option>
              <option value="metacritic_score">Metacritic</option>
            </select>
          </label>
          <strong className="selection-count">{selectedMovies.length} selected</strong>
        </div>
      </div>

      {status === "loading" ? <div className="status-strip">Loading posters…</div> : null}
      {error ? (
        <div className="status-strip error" role="alert">
          {error}
        </div>
      ) : null}
      {response && !response.preferences.omdb_api_key_set ? (
        <div className="status-strip">
          Add an OMDb API key in Settings to load posters and ratings.
        </div>
      ) : null}

      {status === "ready" && movies.length === 0 ? (
        <p className="empty-state">No movies are playing in the current theater search.</p>
      ) : null}
      <div className="movie-grid" aria-live="polite">
        {movies.map((movie) => {
          const selected = selectedMovies.includes(movie.movie);
          return (
            <button
              key={movie.movie}
              type="button"
              className={`movie-tile ${selected ? "selected" : ""}`}
              aria-pressed={selected}
              aria-label={`${selected ? "Deselect" : "Select"} ${movie.movie}`}
              onClick={() => toggleMovie(movie.movie)}
            >
              <span className="poster-frame">
                {movie.poster_url ? (
                  <img src={movie.poster_url} alt={`${movie.movie} poster`} loading="lazy" />
                ) : (
                  <span className="poster-fallback">{movie.movie}</span>
                )}
                <span className="poster-check" aria-hidden="true">
                  ✓
                </span>
              </span>
              <span className="movie-title">{movie.movie}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
