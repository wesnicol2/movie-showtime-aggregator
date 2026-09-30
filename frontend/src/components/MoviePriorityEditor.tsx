import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import "../movie-priority-drag.css";

const LONG_PRESS_MS = 450;
const HOLD_MOVE_TOLERANCE_PX = 8;

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
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingMovieRef = useRef<string | null>(null);
  const pointerStartYRef = useRef(0);
  const lastPointerYRef = useRef(0);
  const draggedMovieRef = useRef<string | null>(null);
  const dragSourceIndexRef = useRef<number | null>(null);
  const dragDestinationRef = useRef<number | null>(null);
  const rowCentersRef = useRef<number[]>([]);
  const rowShiftDistanceRef = useRef(0);
  const [pressingMovie, setPressingMovie] = useState<string | null>(null);
  const [draggingMovie, setDraggingMovie] = useState<string | null>(null);
  const [dragSourceIndex, setDragSourceIndex] = useState<number | null>(null);
  const [dragDestinationIndex, setDragDestinationIndex] = useState<number | null>(null);
  const [dragOffsetY, setDragOffsetY] = useState(0);

  useEffect(() => () => clearPendingTimer(), []);

  if (movies.length === 0) return null;
  const pinned = new Set(pinnedMovies);

  function clearPendingTimer(): void {
    if (pendingTimerRef.current === null) return;
    clearTimeout(pendingTimerRef.current);
    pendingTimerRef.current = null;
  }

  function moveMovieToIndex(movie: string, destinationIndex: number): void {
    const currentIndex = movies.indexOf(movie);
    const boundedDestination = Math.max(0, Math.min(destinationIndex, movies.length - 1));
    if (currentIndex < 0 || currentIndex === boundedDestination) return;

    const direction: -1 | 1 = boundedDestination < currentIndex ? -1 : 1;
    const steps = Math.abs(boundedDestination - currentIndex);
    for (let step = 0; step < steps; step += 1) onMove(movie, direction);
  }

  function rowElements(): HTMLElement[] {
    return Array.from(
      listRef.current?.querySelectorAll<HTMLElement>("[data-movie-priority-row]") ?? [],
    );
  }

  function activateDrag(movie: string, pointerId: number): void {
    if (activePointerId.current !== pointerId || pendingMovieRef.current !== movie) return;
    const sourceIndex = movies.indexOf(movie);
    const rows = rowElements();
    if (sourceIndex < 0 || rows.length !== movies.length) return;

    const bounds = rows.map((row) => row.getBoundingClientRect());
    rowCentersRef.current = bounds.map((rect) => rect.top + rect.height / 2);
    if (bounds.length > 1) {
      const adjacentIndex = sourceIndex < bounds.length - 1 ? sourceIndex + 1 : sourceIndex - 1;
      const adjacent = bounds[adjacentIndex];
      const source = bounds[sourceIndex];
      rowShiftDistanceRef.current =
        adjacent && source ? Math.abs(adjacent.top - source.top) : source?.height ?? 0;
    } else {
      rowShiftDistanceRef.current = bounds[0]?.height ?? 0;
    }

    clearPendingTimer();
    pendingMovieRef.current = null;
    draggedMovieRef.current = movie;
    dragSourceIndexRef.current = sourceIndex;
    dragDestinationRef.current = sourceIndex;
    setPressingMovie(null);
    setDraggingMovie(movie);
    setDragSourceIndex(sourceIndex);
    setDragDestinationIndex(sourceIndex);
    setDragOffsetY(lastPointerYRef.current - pointerStartYRef.current);
  }

  function destinationIndexAt(clientY: number): number | null {
    const centers = rowCentersRef.current;
    if (centers.length === 0) return null;

    let closestIndex = 0;
    let closestDistance = Math.abs(clientY - (centers[0] ?? clientY));
    for (let index = 1; index < centers.length; index += 1) {
      const center = centers[index];
      if (center === undefined) continue;
      const distance = Math.abs(clientY - center);
      if (distance < closestDistance) {
        closestIndex = index;
        closestDistance = distance;
      }
    }
    return closestIndex;
  }

  function beginDrag(event: PointerEvent<HTMLButtonElement>, movie: string): void {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const index = movies.indexOf(movie);
    if (index < 0) return;

    event.preventDefault();
    clearPendingTimer();
    activePointerId.current = event.pointerId;
    pendingMovieRef.current = movie;
    pointerStartYRef.current = event.clientY;
    lastPointerYRef.current = event.clientY;
    dragDestinationRef.current = index;
    setPressingMovie(movie);

    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    pendingTimerRef.current = setTimeout(() => activateDrag(movie, event.pointerId), LONG_PRESS_MS);
  }

  function continueDrag(event: PointerEvent<HTMLButtonElement>, movie: string): void {
    if (activePointerId.current !== event.pointerId) return;
    lastPointerYRef.current = event.clientY;

    if (draggedMovieRef.current === movie) {
      event.preventDefault();
      setDragOffsetY(event.clientY - pointerStartYRef.current);
      const destinationIndex = destinationIndexAt(event.clientY);
      if (destinationIndex === null || destinationIndex === dragDestinationRef.current) return;
      dragDestinationRef.current = destinationIndex;
      setDragDestinationIndex(destinationIndex);
      return;
    }

    if (pendingMovieRef.current !== movie) return;
    if (Math.abs(event.clientY - pointerStartYRef.current) <= HOLD_MOVE_TOLERANCE_PX) return;

    clearPendingTimer();
    pendingMovieRef.current = null;
    activePointerId.current = null;
    setPressingMovie(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function finishDrag(
    event: PointerEvent<HTMLButtonElement>,
    movie: string,
    commit: boolean,
  ): void {
    if (activePointerId.current !== event.pointerId) return;
    const destinationIndex =
      draggedMovieRef.current === movie ? dragDestinationRef.current : null;

    clearPendingTimer();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    activePointerId.current = null;
    pendingMovieRef.current = null;
    draggedMovieRef.current = null;
    dragSourceIndexRef.current = null;
    dragDestinationRef.current = null;
    rowCentersRef.current = [];
    rowShiftDistanceRef.current = 0;
    setPressingMovie(null);
    setDraggingMovie(null);
    setDragSourceIndex(null);
    setDragDestinationIndex(null);
    setDragOffsetY(0);

    if (commit && destinationIndex !== null) moveMovieToIndex(movie, destinationIndex);
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

  function rowShift(index: number): number {
    if (dragSourceIndex === null || dragDestinationIndex === null || index === dragSourceIndex) {
      return 0;
    }
    if (dragSourceIndex < dragDestinationIndex) {
      return index > dragSourceIndex && index <= dragDestinationIndex
        ? -rowShiftDistanceRef.current
        : 0;
    }
    return index >= dragDestinationIndex && index < dragSourceIndex
      ? rowShiftDistanceRef.current
      : 0;
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
        Higher-ranked movies are worth more want points. Press and hold the three-line handle until
        the movie lifts, then drag it into place; use Top to jump a movie to #1. Pin a movie to
        require it in every itinerary. Runtime overrides replace the fetched runtime for Movie Day
        planning; clear an override to use the fetched value again.
      </p>
      <ol className="movie-priority-list" ref={listRef} aria-describedby="movie-priority-help">
        {movies.map((movie, index) => {
          const isPinned = pinned.has(movie);
          const wantScore = movies.length - index;
          const runtimeOverride = runtimeOverrides[movie];
          const defaultRuntime = defaultRuntimeByMovie[movie] ?? null;
          const isPressing = pressingMovie === movie;
          const isDragging = draggingMovie === movie;
          const isDropTarget =
            draggingMovie !== null && dragDestinationIndex === index && !isDragging;
          const shift = rowShift(index);
          const rowClasses = [
            isPressing ? "is-pressing" : "",
            isDragging ? "is-dragging" : "",
            isDropTarget ? "is-drop-target" : "",
            shift !== 0 ? "is-shifting" : "",
          ]
            .filter(Boolean)
            .join(" ");
          const rowStyle: CSSProperties | undefined = isDragging
            ? { transform: `translateY(${dragOffsetY}px) scale(1.015)` }
            : shift !== 0
              ? { transform: `translateY(${shift}px)` }
              : undefined;

          return (
            <li
              key={movie}
              data-movie-priority-row
              className={rowClasses.length > 0 ? rowClasses : undefined}
              style={rowStyle}
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
                  aria-label={`Hold and drag ${movie} to reorder`}
                  title="Hold, then drag to reorder"
                  onPointerDown={(event) => beginDrag(event, movie)}
                  onPointerMove={(event) => continueDrag(event, movie)}
                  onPointerUp={(event) => finishDrag(event, movie, true)}
                  onPointerCancel={(event) => finishDrag(event, movie, false)}
                  onKeyDown={(event) => handleDragKeyDown(event, movie)}
                >
                  <svg className="movie-priority-drag-icon" viewBox="0 0 18 18" aria-hidden="true">
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
