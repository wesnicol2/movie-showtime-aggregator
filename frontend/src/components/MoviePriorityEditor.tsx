interface Props {
  movies: readonly string[];
  pinnedMovies: readonly string[];
  onMove: (movie: string, direction: -1 | 1) => void;
  onTogglePinned: (movie: string) => void;
}

export function MoviePriorityEditor({
  movies,
  pinnedMovies,
  onMove,
  onTogglePinned,
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
        <span>{pinnedMovies.length} pinned</span>
      </header>
      <p className="movie-priority-help">
        Higher-ranked movies are worth more want points. Pin a movie to require it in every
        itinerary.
      </p>
      <ol className="movie-priority-list">
        {movies.map((movie, index) => {
          const isPinned = pinned.has(movie);
          const wantScore = movies.length - index;
          return (
            <li key={movie}>
              <span className="movie-priority-rank">#{index + 1}</span>
              <div className="movie-priority-title">
                <strong>{movie}</strong>
                <span>
                  {wantScore} want point{wantScore === 1 ? "" : "s"}
                </span>
              </div>
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
