import { create } from "zustand";

import { readSavedMoviePlans } from "./planner";
import { type ColumnFilter, createEmptyFilters, type Filters, type SortState } from "./screenings";
import { browserDate } from "./show-date";
import type { ColumnKey, ScreeningsResponse } from "./types";

const MOVIE_SELECTION_KEY = "movie-showtime-aggregator.selected-movies.v1";
const WANT_LIST_MIGRATION_KEY = "movie-showtime-aggregator.want-list-migration.v1";
const SAVED_VIEWS_KEY = "movie-showtime-aggregator.saved-views.v1";

export interface SavedView {
  sort: SortState;
  filters: Filters;
}

function readMovieSelection(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(MOVIE_SELECTION_KEY) ?? "[]");
    const values = Array.isArray(parsed)
      ? parsed
      : typeof parsed === "object" && parsed !== null && "movies" in parsed
        ? (parsed as { movies?: unknown }).movies
        : [];
    return Array.isArray(values)
      ? values.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

function persistMovieSelection(values: string[]): void {
  if (values.length === 0) {
    localStorage.removeItem(MOVIE_SELECTION_KEY);
    return;
  }
  localStorage.setItem(MOVIE_SELECTION_KEY, JSON.stringify([...values].sort()));
}

function migrateWantList(values: string[]): string[] {
  if (localStorage.getItem(WANT_LIST_MIGRATION_KEY) === "1") return values;

  const today = browserDate();
  const plannedMovies = readSavedMoviePlans()
    .filter((plan) => plan.date >= today)
    .flatMap((plan) => plan.itinerary.movies);
  const migrated = [...new Set([...values, ...plannedMovies])].sort();
  persistMovieSelection(migrated);
  localStorage.setItem(WANT_LIST_MIGRATION_KEY, "1");
  return migrated;
}

function withoutMovieSelection(view: SavedView): SavedView {
  const filters = structuredClone(view.filters);
  filters.movie = { ...filters.movie, selected: null };
  return { sort: { ...view.sort }, filters };
}

export function createSavedView(sort: SortState, filters: Filters): SavedView {
  return withoutMovieSelection({ sort, filters });
}

export function readSavedViews(): Record<string, SavedView> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SAVED_VIEWS_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const migrated = Object.fromEntries(
      Object.entries(parsed).map(([name, view]) => [
        name,
        withoutMovieSelection(view as SavedView),
      ]),
    );
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(migrated));
    return migrated;
  } catch {
    return {};
  }
}

export function writeSavedViews(views: Record<string, SavedView>): void {
  const sanitized = Object.fromEntries(
    Object.entries(views).map(([name, view]) => [name, withoutMovieSelection(view)]),
  );
  localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(sanitized));
}

const initialSelection = migrateWantList(readMovieSelection());
const initialFilters = createEmptyFilters();

interface AppState {
  response: ScreeningsResponse | null;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  selectedDate: string;
  filters: Filters;
  sort: SortState;
  selectedMovies: string[];
  planningDraftDate: string | null;
  planningDraftMovies: string[] | null;
  inspectedShowtimeId: string | null;
  setLoading: () => void;
  setResponse: (response: ScreeningsResponse) => void;
  setError: (message: string) => void;
  setSelectedDate: (date: string) => void;
  invalidateScreenings: () => void;
  toggleSort: (key: ColumnKey) => void;
  updateFilter: (key: ColumnKey, patch: Partial<ColumnFilter>) => void;
  clearAllFilters: () => void;
  toggleMovie: (movie: string) => void;
  setMovieSelection: (movies: string[]) => void;
  syncMovieSelection: () => void;
  setPlanningDraft: (date: string, movies: string[] | null) => void;
  clearPlanningDraft: () => void;
  setInspectedShowtimeId: (showtimeId: string | null) => void;
  applySavedView: (view: SavedView) => void;
}

export const useAppStore = create<AppState>((set) => ({
  response: null,
  status: "idle",
  error: null,
  selectedDate: browserDate(),
  filters: initialFilters,
  sort: { key: "advertised_start", direction: "asc" },
  selectedMovies: initialSelection,
  planningDraftDate: null,
  planningDraftMovies: null,
  inspectedShowtimeId: null,

  setLoading: () => set({ status: "loading", error: null }),
  setResponse: (response) => set({ response, status: "ready", error: null }),
  setError: (message) => set({ response: null, status: "error", error: message }),
  setSelectedDate: (selectedDate) =>
    set((state) => {
      if (!selectedDate || selectedDate === state.selectedDate) return {};
      return {
        selectedDate,
        response: null,
        status: "idle",
        error: null,
        inspectedShowtimeId: null,
      };
    }),
  invalidateScreenings: () => set({ response: null, status: "idle", error: null }),

  toggleSort: (key) =>
    set((state) => ({
      sort:
        state.sort.key === key
          ? { key, direction: state.sort.direction === "asc" ? "desc" : "asc" }
          : { key, direction: "asc" },
    })),

  updateFilter: (key, patch) =>
    set((state) => {
      const nextFilter = { ...state.filters[key], ...patch };
      return { filters: { ...state.filters, [key]: nextFilter } };
    }),

  clearAllFilters: () => set({ filters: createEmptyFilters() }),

  toggleMovie: (movie) =>
    set((state) => {
      const selectedMovies = state.selectedMovies.includes(movie)
        ? state.selectedMovies.filter((value) => value !== movie)
        : [...state.selectedMovies, movie].sort();
      persistMovieSelection(selectedMovies);
      return { selectedMovies };
    }),

  setMovieSelection: (movies: string[]) =>
    set(() => {
      const selectedMovies = [...new Set(movies)].sort();
      persistMovieSelection(selectedMovies);
      return { selectedMovies };
    }),

  syncMovieSelection: () => set({ selectedMovies: readMovieSelection() }),

  setPlanningDraft: (planningDraftDate, movies) =>
    set({
      planningDraftDate,
      planningDraftMovies: movies === null ? null : [...new Set(movies)].sort(),
    }),

  clearPlanningDraft: () => set({ planningDraftDate: null, planningDraftMovies: null }),

  setInspectedShowtimeId: (inspectedShowtimeId) => set({ inspectedShowtimeId }),

  applySavedView: (view) =>
    set(() => ({
      sort: { ...view.sort },
      filters: structuredClone(view.filters),
      inspectedShowtimeId: null,
    })),
}));
