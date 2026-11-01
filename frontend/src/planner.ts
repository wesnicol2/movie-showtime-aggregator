import type { MovieDayItinerary, Screening, ScreeningLocation } from "./types";

export const PLANNER_STORAGE_KEY = "movie-showtime-aggregator.planner.v1";
export const PLANNER_UPDATED_EVENT = "movie-showtime-aggregator:planner-updated";

export interface SavedMoviePlan {
  date: string;
  savedAt: string;
  location?: ScreeningLocation;
  itinerary: MovieDayItinerary;
  screenings: Screening[];
  runtimeOverrides: Record<string, number>;
}

export function readSavedMoviePlans(): SavedMoviePlan[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PLANNER_STORAGE_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    const plans = Object.values(parsed)
      .map(parseSavedMoviePlan)
      .filter((plan): plan is SavedMoviePlan => plan !== null)
      .sort((left, right) => left.date.localeCompare(right.date));
    return plans;
  } catch {
    return [];
  }
}

export function savedMoviePlanForDate(date: string, zipCode?: string): SavedMoviePlan | null {
  return (
    readSavedMoviePlans().find(
      (plan) =>
        plan.date === date && (!zipCode || !plan.location || plan.location.zip_code === zipCode),
    ) ?? null
  );
}

export function saveMoviePlan(plan: SavedMoviePlan): void {
  const key = (saved: SavedMoviePlan) => `${saved.date}|${saved.location?.zip_code ?? "legacy"}`;
  const plans = Object.fromEntries(readSavedMoviePlans().map((saved) => [key(saved), saved]));
  plans[key(plan)] = structuredClone(plan);
  localStorage.setItem(PLANNER_STORAGE_KEY, JSON.stringify(plans));
  window.dispatchEvent(new Event(PLANNER_UPDATED_EVENT));
}

export function deleteMoviePlan(date: string, zipCode?: string): void {
  const plans = Object.fromEntries(
    readSavedMoviePlans()
      .filter(
        (plan) => plan.date !== date || (zipCode != null && plan.location?.zip_code !== zipCode),
      )
      .map((plan) => [`${plan.date}|${plan.location?.zip_code ?? "legacy"}`, plan]),
  );
  if (Object.keys(plans).length === 0) localStorage.removeItem(PLANNER_STORAGE_KEY);
  else localStorage.setItem(PLANNER_STORAGE_KEY, JSON.stringify(plans));
  window.dispatchEvent(new Event(PLANNER_UPDATED_EVENT));
}

function parseSavedMoviePlan(value: unknown): SavedMoviePlan | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<SavedMoviePlan>;
  if (
    typeof candidate.date !== "string" ||
    typeof candidate.savedAt !== "string" ||
    !candidate.itinerary ||
    !Array.isArray(candidate.screenings) ||
    !candidate.runtimeOverrides ||
    typeof candidate.runtimeOverrides !== "object" ||
    Array.isArray(candidate.runtimeOverrides)
  ) {
    return null;
  }
  return candidate as SavedMoviePlan;
}
