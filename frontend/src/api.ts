import { browserDate } from "./show-date";
import type {
  MovieDayPlanRequest,
  MovieDayPlanResponse,
  ScreeningsResponse,
  SharedSettings,
  SharedSettingsChanges,
} from "./types";

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? `Request failed (${response.status})`);
  }
  return payload;
}

export function fetchScreenings(enrich?: boolean): Promise<ScreeningsResponse>;
export function fetchScreenings(showDate: string, enrich?: boolean): Promise<ScreeningsResponse>;
export function fetchScreenings(
  showDateOrEnrich: string | boolean = browserDate(),
  requestedEnrich = true,
): Promise<ScreeningsResponse> {
  const showDate = typeof showDateOrEnrich === "string" ? showDateOrEnrich : browserDate();
  const enrich = typeof showDateOrEnrich === "boolean" ? showDateOrEnrich : requestedEnrich;
  const params = new URLSearchParams({ date: showDate });
  if (!enrich) {
    params.set("enrich", "0");
  }
  return requestJson<ScreeningsResponse>(`/api/screenings?${params.toString()}`);
}

export function fetchSharedSettings(): Promise<SharedSettings> {
  return requestJson<SharedSettings>("/api/settings");
}

export function createMovieDayPlan(request: MovieDayPlanRequest): Promise<MovieDayPlanResponse> {
  return requestJson<MovieDayPlanResponse>("/api/movie-day", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
}

export function saveSharedSettings(changes: SharedSettingsChanges): Promise<SharedSettings> {
  return requestJson<SharedSettings>("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(changes),
  });
}
