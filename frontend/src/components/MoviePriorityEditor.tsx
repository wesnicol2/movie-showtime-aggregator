import { type KeyboardEvent, type PointerEvent, useRef, useState } from "react";

import "../movie-priority-drag.css";

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
  const listRef = useRef<HTMLOListElement>(null);
  const activePointerId = useRef<number | null>(null);
  const draggedMovieRef = useRef<string | null>(null);
  const [draggingMovie, setDraggingMovie] = useState<string | null>(null);

  if (movies.length === 0) return null;
  const pinned = new Set(pinnedMovies);

  function moveMovieToIndex(movie: string, destinationIndex: number): void {
    const currentIndex = movies.indexOf(movie);
    const boundedDestination = Math.max(0, Math.min(destinationIndex, movies.length - 1));
    if (currentIndex < 0 || currentIndex === boundedDestination) return;

    const direction: -1 | 1 = boundedDestination < currentIndex ? -1 : 1;
    const steps = Math.abs(boundedDestination - currentIndex);
    for (let step = 0; step < steps; step += 1) onMove(movie, direction);
  }

  function destinationIndexAt(clientY: number): number | null {
    const rows = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>("[data-movie-priority-row]") ?? [],
    );
    if (rows.length === 0) return null;

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (row === undefined) continue;
      const bounds = row.getBoundingClientRect();
      if (clientY < bounds.top + bounds.height / 2) return index;
    }
    return rows.length - 1;
  }

  function beginDrag(event: PointerEvent<HTMLButtonElement>, movie: string): void {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    activePointerId.current = event.pointerId;
    draggedMovieRef.current = movie;
    setDraggingMovie(movie);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function continueDrag(event: PointerEvent<HTMLButtonElement>, movie: string): void {
    if (activePointerId.current !== event.pointerId || draggedMovieRef.current !== movie) return;
    event.preventDefault();
    const destinationIndex = destinationIndexAt(event.clientY);
    if (destinationIndex !== null) moveMovieToIndex(movie, destinationIndex);
  }

  function endDrag(event: PointerEvent<HTMLButtonElement>, movie: string): void {
    if (activePointerId.current !== event.pointerId || draggedMovieRef.current !== movie) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    activePointerId.current = null;
    draggedMovieRef.current = null;
    setDraggingMovie(null);
  }

  function handleDragKeyDown(event: KeyboardEvent<HTMLButtonElement>, movie: string): void {
    const index = movies.indexOf(movie);
    if (index < 0) return;
    if (event.key === "ArrowUp" && index > 0) {
      event.preventDefault();
      onMove(movie, -1);
    } else if (event.key === "ArrowDown" && index < movies.length - 1) {
      event.preventDefault();
      onMove(movie, 1);
    } else if (event.key === "Home" && index > 0) {
      event.preventDefault();
      moveMovieToIndex(movie, 0);
    }
  }

  return (
    <section className="movie-priority-panel" aria-labelledby="movie-priority-heading">
      <header>
        <div>
          <p className="eyebrow">MOVIE PRIORITY</p>
          <h2 id="movie-priority-heading">Rank what you want to see</h2>
        </div>
        <span className="movie-priority-pinned-count">{pinnedMovies.length} pinned</span>
      </header>
      <p className="movie-priority-help" id="movie-priority-help">
        Higher-ranked movies are worth more want points. Press and drag the three-line handle to
        reorder, or use Top to jump a movie to #1. Pin a movie to require it in every itinerary.
        Runtime overrides replace the fetched runtime for Movie Day planning; clear an override to
        use the fetched value again.
      </p>
      <ol className="movie-priority-list" ref={listRef} aria-describedby="movie-priority-help">
        {movies.map((movie, index) => {
          const isPinned = pinned.has(movie);
          const wantScore = movies.length - index;
          const runtimeOverride = runtimeOverrides[movie];
          const defaultRuntime = defaultRuntimeByMovie[movie] ?? null;
          const isDragging = draggingMovie === movie;
          return (
            <li
              key={movie}
              data-movie-priority-row
              className={isDragging ? "is-dragging" : undefined}
            >
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
              <div className="movie-priority-ordering">
                <button
                  type="button"
                  className="movie-priority-drag-handle"
                  aria-label={`Drag ${movie} to reorder`}
                  title="Drag to reorder"
                  onPointerDown={(event) => beginDrag(event, movie)}
                  onPointerMove={(event) => continueDrag(event, movie)}
                  onPointerUp={(event) => endDrag(event, movie)}
                  onPointerCancel={(event) => endDrag(event, movie)}
                  onKeyDown={(event) => handleDragKeyDown(event, movie)}
                >
                  <svg
                    className="movie-priority-drag-icon"
                    viewBox="0 0 18 18"
                    aria-hidden="true"
                  >
                    <path d="M3 5h12M3 9h12M3 13h12" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="movie-priority-top"
                  aria-label={`Move ${movie} up; send to top`}
                  title="Send to top"
                  disabled={index === 0}
                  onClick={() => moveMovieToIndex(movie, 0)}
                >
                  Top
                </button>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
