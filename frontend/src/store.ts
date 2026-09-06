import { create } from "zustand";

import { type ColumnFilter, createEmptyFilters, type Filters, type SortState } from "./screenings";
import type { ColumnKey, ScreeningsResponse } from "./types";

const MOVIE_SELECTION_KEY = "movie-showtime-aggregator.selected-movies.v1";
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

export function readSavedViews(): Record<string, SavedView> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SAVED_VIEWS_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, SavedView>;
  } catch {
    return {};
  }
}

export function writeSavedViews(views: Record<string, SavedView>): void {
  localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(views));
}

const initialSelection = readMovieSelection();
const initialFilters = createEmptyFilters();
if (initialSelection.length > 0) {
  initialFilters.movie.selected = [...initialSelection];
}

interface AppState {
  response: ScreeningsResponse | null;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  filters: Filters;
  sort: SortState;
  selectedMovies: string[];
  inspectedShowtimeId: string | null;
  setLoading: () => void;
  setResponse: (response: ScreeningsResponse) => void;
  setError: (message: string) => void;
  invalidateScreenings: () => void;
  toggleSort: (key: ColumnKey) => void;
  updateFilter: (key: ColumnKey, patch: Partial<ColumnFilter>) => void;
  clearAllFilters: () => void;
  toggleMovie: (movie: string) => void;
  syncMovieSelection: () => void;
  setInspectedShowtimeId: (showtimeId: string | null) => void;
  applySavedView: (view: SavedView) => void;
}

export const useAppStore = create<AppState>((set) => ({
  response: null,
  status: "idle",
  error: null,
  filters: initialFilters,
  sort: { key: "advertised_start", direction: "asc" },
  selectedMovies: initialSelection,
  inspectedShowtimeId: null,

  setLoading: () => set({ status: "loading", error: null }),
  setResponse: (response) => set({ response, status: "ready", error: null }),
  setError: (message) => set({ response: null, status: "error", error: message }),
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
      const filters = { ...state.filters, [key]: nextFilter };
      if (key !== "movie" || patch.selected === undefined) return { filters };
      const selectedMovies = patch.selected ?? [];
      persistMovieSelection(selectedMovies);
      return { filters, selectedMovies };
    }),

  clearAllFilters: () => {
    persistMovieSelection([]);
    set({ filters: createEmptyFilters(), selectedMovies: [] });
  },

  toggleMovie: (movie) =>
    set((state) => {
      const selectedMovies = state.selectedMovies.includes(movie)
        ? state.selectedMovies.filter((value) => value !== movie)
        : [...state.selectedMovies, movie].sort();
      persistMovieSelection(selectedMovies);
      return {
        selectedMovies,
        filters: {
          ...state.filters,
          movie: {
            ...state.filters.movie,
            selected: selectedMovies.length > 0 ? selectedMovies : null,
          },
        },
      };
    }),

  syncMovieSelection: () =>
    set((state) => {
      const selectedMovies = readMovieSelection();
      return {
        selectedMovies,
        filters: {
          ...state.filters,
          movie: {
            ...state.filters.movie,
            selected: selectedMovies.length > 0 ? selectedMovies : null,
          },
        },
      };
    }),

  setInspectedShowtimeId: (inspectedShowtimeId) => set({ inspectedShowtimeId }),

  applySavedView: (view) => {
    const selectedMovies = view.filters.movie.selected ?? [];
    persistMovieSelection(selectedMovies);
    set({
      sort: { ...view.sort },
      filters: structuredClone(view.filters),
      selectedMovies,
      inspectedShowtimeId: null,
    });
  },
}));
