export const SETTINGS_KEY = "movie-showtime-aggregator.settings.v1";
export const LOCATION_CHANGED_EVENT = "movie-showtime-aggregator:location-changed";

export interface SearchLocation {
  zipCode: string;
  radiusMiles: number;
}

export interface BrowserHome {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
}

export interface BrowserSettings {
  location?: SearchLocation;
  previewMinutes?: Record<string, number>;
  savedHomes?: BrowserHome[];
  activeHomeId?: string | null;
}

function validHome(value: BrowserHome): boolean {
  return (
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    Number.isFinite(value.latitude) &&
    Number.isFinite(value.longitude) &&
    Math.abs(value.latitude) <= 90 &&
    Math.abs(value.longitude) <= 180
  );
}

export function readBrowserSettings(): BrowserSettings {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const settings = value as BrowserSettings;
    const savedHomes = Array.isArray(settings.savedHomes)
      ? settings.savedHomes.filter(validHome)
      : [];
    return { ...settings, savedHomes };
  } catch {
    return {};
  }
}

export function activeBrowserHome(settings = readBrowserSettings()): BrowserHome | null {
  return settings.savedHomes?.find((home) => home.id === settings.activeHomeId) ?? null;
}

function cookie(name: string, value: unknown | null): void {
  // biome-ignore lint/suspicious/noDocumentCookie: The Python API reads these per-browser preferences synchronously.
  document.cookie =
    value === null
      ? `${name}=; Max-Age=0; Path=/; SameSite=Lax`
      : `${name}=${encodeURIComponent(JSON.stringify(value))}; Max-Age=31536000; Path=/; SameSite=Lax`;
}

export function bootstrapLocationCookies(): void {
  if (typeof document === "undefined" || typeof localStorage === "undefined") return;
  const settings = readBrowserSettings();
  cookie("movie_location", settings.location ?? null);
  cookie("movie_preview_minutes", settings.previewMinutes ?? {});
  const home = activeBrowserHome(settings);
  cookie("movie_home", home ? { latitude: home.latitude, longitude: home.longitude } : null);
}

export function saveBrowserSettings(settings: BrowserSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  bootstrapLocationCookies();
  window.dispatchEvent(new Event(LOCATION_CHANGED_EVENT));
}

export function chooseBrowserHome(id: string | null): void {
  const settings = readBrowserSettings();
  settings.activeHomeId = id;
  saveBrowserSettings(settings);
}

export function addBrowserHome(home: Omit<BrowserHome, "id">, location?: SearchLocation): void {
  if (!Number.isFinite(home.latitude) || !Number.isFinite(home.longitude)) {
    throw new Error("Invalid home coordinates");
  }
  const settings = readBrowserSettings();
  const id = `home-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  settings.savedHomes = [...(settings.savedHomes ?? []), { ...home, id }];
  settings.activeHomeId = id;
  if (location) settings.location = location;
  saveBrowserSettings(settings);
}

export function removeBrowserHome(id: string): void {
  const settings = readBrowserSettings();
  settings.savedHomes = settings.savedHomes?.filter((home) => home.id !== id) ?? [];
  if (settings.activeHomeId === id) settings.activeHomeId = null;
  saveBrowserSettings(settings);
}
