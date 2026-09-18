interface Props {
  movies: readonly string[];
  pinnedMovies: readonly string[];
  defaultRuntimeByMovie: Readonly<Record<string, number | null>>;
  runtimeOverrides: Readonly<Record<string, number>>;
  onMove: (movie: string, direction: -1 | 1) => void;
  onTogglePinned: (movie: string) => void;
  onRuntimeOverrideChange: (movie: string, minutes: number | null) => void;
}

export function MoviePriorityEditor({
  movies,
  pinnedMovies,
  defaultRuntimeByMovie,
  runtimeOverrides,
  onMove,
  onTogglePinned,
  onRuntimeOverrideChange,
}: Props) {
  if (movies.length === 0) return null;
  const pinned = new Set(pinnedMovies);

  return (
    <section className="movie-priority-panel" aria-labelledby="movie-priority-heading">
      <header>
        <div>
          <p className="eyebrow">MOVIE PRIORITY</p>
          <h2 id="movie-priority-heading">Rank what you want to see</h2>
        </div>
        <span className="movie-priority-pinned-count">{pinnedMovies.length} pinned</span>
      </header>
      <p className="movie-priority-help">
        Higher-ranked movies are worth more want points. Pin a movie to require it in every
        itinerary. Runtime overrides replace the fetched runtime for Movie Day planning; clear an
        override to use the fetched value again.
      </p>
      <ol className="movie-priority-list">
        {movies.map((movie, index) => {
          const isPinned = pinned.has(movie);
          const wantScore = movies.length - index;
          const runtimeOverride = runtimeOverrides[movie];
          const defaultRuntime = defaultRuntimeByMovie[movie] ?? null;
          return (
            <li key={movie}>
              <span className="movie-priority-rank">#{index + 1}</span>
              <div className="movie-priority-title">
                <strong>{movie}</strong>
                <span>
                  {wantScore} want point{wantScore === 1 ? "" : "s"}
                </span>
              </div>
              <label className="movie-runtime-editor">
                <span>Runtime</span>
                <span className="movie-runtime-input">
                  <input
                    type="number"
                    min="1"
                    max="600"
                    step="1"
                    inputMode="numeric"
                    aria-label={`${movie} runtime minutes`}
                    value={runtimeOverride ?? ""}
                    placeholder={defaultRuntime === null ? "Set" : String(defaultRuntime)}
                    onChange={(event) => {
                      const raw = event.currentTarget.value;
                      if (raw === "") {
                        onRuntimeOverrideChange(movie, null);
                        return;
                      }
                      const minutes = Number(raw);
                      if (Number.isInteger(minutes)) onRuntimeOverrideChange(movie, minutes);
                    }}
                  />
                  <span>min</span>
                </span>
                <small>
                  {runtimeOverride !== undefined
                    ? "Manual override"
                    : defaultRuntime === null
                      ? "Unknown — set manually"
                      : `Fetched ${defaultRuntime} min`}
                </small>
              </label>
              <button
                type="button"
                className={isPinned ? "movie-pin is-pinned" : "movie-pin"}
                aria-pressed={isPinned}
                aria-label={`${isPinned ? "Unpin" : "Pin"} ${movie}`}
                onClick={() => onTogglePinned(movie)}
              >
                {isPinned ? "Pinned" : "Pin"}
              </button>
              <div className="movie-priority-moves">
                <button
                  type="button"
                  aria-label={`Move ${movie} up`}
                  disabled={index === 0}
                  onClick={() => onMove(movie, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Move ${movie} down`}
                  disabled={index === movies.length - 1}
                  onClick={() => onMove(movie, 1)}
                >
                  ↓
                </button>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
