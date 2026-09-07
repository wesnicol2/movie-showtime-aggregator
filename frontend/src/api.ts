import type { ScreeningsResponse, SharedSettings, SharedSettingsChanges } from "./types";

function browserDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? `Request failed (${response.status})`);
  }
  return payload;
}

export function fetchScreenings(enrich = true): Promise<ScreeningsResponse> {
  const params = new URLSearchParams({ date: browserDate() });
  if (!enrich) {
    params.set("enrich", "0");
  }
  return requestJson<ScreeningsResponse>(`/api/screenings?${params.toString()}`);
}

export function fetchSharedSettings(): Promise<SharedSettings> {
  return requestJson<SharedSettings>("/api/settings");
}

export function saveSharedSettings(changes: SharedSettingsChanges): Promise<SharedSettings> {
  return requestJson<SharedSettings>("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(changes),
  });
}
