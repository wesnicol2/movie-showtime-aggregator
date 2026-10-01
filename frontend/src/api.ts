import { browserDate } from "./show-date";
import type {
  MovieDayItinerary,
  MovieDayPlanRequest,
  MovieDayPlanResponse,
  MovieDaySort,
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
  if (request.target_movie_count === "any") return createAnyMovieDayPlan(request);
  return requestExactMovieDayPlan(request as MovieDayPlanRequest & { target_movie_count: number });
}

async function createAnyMovieDayPlan(request: MovieDayPlanRequest): Promise<MovieDayPlanResponse> {
  const minimumCount = Math.max(1, request.required_movies.length);
  const pageOffset = request.offset ?? 0;
  const pageLimit = request.limit ?? 50;
  const pageEnd = pageOffset + pageLimit;
  const exactPlans = await Promise.all(
    Array.from(
      { length: Math.max(0, request.movies.length - minimumCount + 1) },
      (_, index) => minimumCount + index,
    ).map((targetCount) => collectExactMovieDayPlan(request, targetCount, pageEnd)),
  );
  const reference = exactPlans[0];
  if (!reference) {
    throw new Error("Select at least one movie to plan a movie day.");
  }

  const itineraries = exactPlans
    .flatMap((plan) => plan.itineraries)
    .sort((left, right) =>
      compareItineraries(left, right, reference.sort_by, reference.secondary_sort_by),
    );
  const totalItineraries = exactPlans.reduce((total, plan) => total + plan.total_itineraries, 0);
  const page = itineraries.slice(pageOffset, pageEnd);

  return {
    ...reference,
    target_movie_count: "any",
    total_itineraries: totalItineraries,
    offset: pageOffset,
    limit: pageLimit,
    has_more: pageOffset + page.length < totalItineraries,
    itineraries: page,
  };
}

async function collectExactMovieDayPlan(
  request: MovieDayPlanRequest,
  targetCount: number,
  requiredCount: number,
): Promise<MovieDayPlanResponse> {
  const firstLimit = Math.min(100, Math.max(1, requiredCount));
  const first = await requestExactMovieDayPlan({
    ...request,
    target_movie_count: targetCount,
    offset: 0,
    limit: firstLimit,
  });
  if (
    first.itineraries.length >= requiredCount ||
    first.itineraries.length >= first.total_itineraries
  ) {
    return first;
  }

  const itineraries = [...first.itineraries];
  let offset = itineraries.length;
  while (offset < first.total_itineraries && offset < requiredCount) {
    const next = await requestExactMovieDayPlan({
      ...request,
      target_movie_count: targetCount,
      offset,
      limit: Math.min(100, requiredCount - offset),
    });
    if (next.itineraries.length === 0) break;
    itineraries.push(...next.itineraries);
    offset += next.itineraries.length;
  }
  return { ...first, itineraries };
}

function requestExactMovieDayPlan(
  request: MovieDayPlanRequest & { target_movie_count: number },
): Promise<MovieDayPlanResponse> {
  return requestJson<MovieDayPlanResponse>("/api/movie-day", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
}

function compareItineraries(
  left: MovieDayItinerary,
  right: MovieDayItinerary,
  sortBy: MovieDaySort,
  secondarySortBy: MovieDaySort,
): number {
  const primary = compareMetric(left, right, sortBy);
  if (primary !== 0) return primary;
  const secondary = compareMetric(left, right, secondarySortBy);
  if (secondary !== 0) return secondary;
  if (sortBy === "want" && secondarySortBy === "elapsed") {
    const driving = compareMetric(left, right, "driving");
    if (driving !== 0) return driving;
  }
  const starts = left.starts_at.localeCompare(right.starts_at);
  if (starts !== 0) return starts;
  return left.showtime_ids.join("\u0000").localeCompare(right.showtime_ids.join("\u0000"));
}

function compareMetric(
  left: MovieDayItinerary,
  right: MovieDayItinerary,
  sortBy: MovieDaySort,
): number {
  if (sortBy === "want") return right.want_score - left.want_score;
  if (sortBy === "driving") return left.travel_minutes - right.travel_minutes;
  return left.elapsed_minutes - right.elapsed_minutes;
}

export function saveSharedSettings(changes: SharedSettingsChanges): Promise<SharedSettings> {
  return requestJson<SharedSettings>("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(changes),
  });
}
