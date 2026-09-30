const DEFAULT_SAVED_VIEWS_KEY = "movie-showtime-aggregator.default-saved-views.v1";

export type SavedViewPage = "screenings" | "movies" | "movie-day";

type DefaultSavedViews = Partial<Record<SavedViewPage, string>>;

export function readDefaultSavedView(page: SavedViewPage): string {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(DEFAULT_SAVED_VIEWS_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "";
    const value = (parsed as DefaultSavedViews)[page];
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

export function writeDefaultSavedView(page: SavedViewPage, name: string | null): void {
  let defaults: DefaultSavedViews = {};
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(DEFAULT_SAVED_VIEWS_KEY) ?? "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      defaults = { ...(parsed as DefaultSavedViews) };
    }
  } catch {
    defaults = {};
  }

  if (name) defaults[page] = name;
  else delete defaults[page];

  if (Object.keys(defaults).length === 0) {
    localStorage.removeItem(DEFAULT_SAVED_VIEWS_KEY);
    return;
  }
  localStorage.setItem(DEFAULT_SAVED_VIEWS_KEY, JSON.stringify(defaults));
}
