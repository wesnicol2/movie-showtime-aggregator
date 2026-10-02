import { expect, type Page, test } from "@playwright/test";

const baseScreening = {
  chain: "AMC",
  distance_miles: 4,
  movie_source_id: "movie",
  drive_to_minutes: 0,
  drive_home_minutes: 0,
  leave_home: null,
  home_arrival: null,
  poster_url: "",
  imdb_id: "",
  imdb_rating: null,
  metacritic_score: null,
  rotten_tomatoes_score: null,
  initial_release_date: null,
  ticket_price: null,
  seats_left_percent: null,
  amc_a_list_eligible: null,
  amc_source_url: "",
  letterboxd_url: "",
  imdb_url: "",
  rotten_tomatoes_url: "",
  metacritic_url: "",
  route_source_url: "",
  theatre: "AMC Center 8",
  theatre_latitude: 33.45,
  theatre_longitude: -112.07,
};

const screenings = [
  {
    ...baseScreening,
    showtime_id: "alpha-standard",
    movie: "Alpha",
    format: "Standard",
    advertised_start: "2026-09-10T08:35:00",
    actual_start: "2026-09-10T09:00:00",
    estimated_end: "2026-09-10T10:00:00",
    runtime_minutes: 60,
    purchase_url: "https://example.test/alpha",
    experience_deviations: [],
    experience_score_adjustment: 0,
  },
  {
    ...baseScreening,
    showtime_id: "beta-imax",
    movie: "Beta",
    format: "IMAX",
    advertised_start: "2026-09-10T10:05:00",
    actual_start: "2026-09-10T10:30:00",
    estimated_end: "2026-09-10T11:30:00",
    runtime_minutes: 60,
    purchase_url: "https://example.test/beta",
    experience_deviations: [
      {
        id: "format:imax",
        label: "IMAX",
        category: "presentation",
        polarity: "positive",
        score_delta: 1,
      },
    ],
    experience_score_adjustment: 1,
  },
  {
    ...baseScreening,
    showtime_id: "gamma-event",
    movie: "Gamma",
    format: "Standard",
    advertised_start: "2026-09-10T11:35:00",
    actual_start: "2026-09-10T12:00:00",
    estimated_end: "2026-09-10T13:00:00",
    runtime_minutes: 60,
    purchase_url: "https://example.test/gamma",
    experience_deviations: [
      {
        id: "event:fan-event",
        label: "Fan Event",
        category: "event",
        polarity: "positive",
        score_delta: 1,
      },
      {
        id: "seating:no-signature-recliners",
        label: "No Signature Recliners",
        category: "seating",
        polarity: "negative",
        score_delta: -1,
      },
    ],
    experience_score_adjustment: 0,
  },
];

async function mockExperienceApi(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem(
      "movie-showtime-aggregator.selected-movies.v1",
      JSON.stringify(["Alpha", "Beta", "Gamma"]),
    );
  });

  await page.route("**/api/screenings?*", async (route) => {
    await route.fulfill({
      json: {
        date: "2026-09-10",
        market_zip: "85004",
        radius_miles: 25,
        location: { zip_code: "85004", radius_miles: 25 },
        preferences: {
          amc_vendor_key_set: false,
          omdb_api_key_set: false,
          amc_a_list: false,
          home_configured: true,
        },
        preview_minutes_by_chain: { AMC: 25 },
        enrichment_enabled: true,
        count: screenings.length,
        total_count: screenings.length,
        facets: {
          chains: ["AMC"],
          movies: ["Alpha", "Beta", "Gamma"],
          theatres: ["AMC Center 8"],
          formats: ["Standard", "IMAX"],
        },
        screenings,
      },
    });
  });

  await page.route("**/api/movie-day", async (route) => {
    const request = route.request().postDataJSON();
    await route.fulfill({
      json: {
        date: "2026-09-10",
        selected_movies: ["Alpha", "Beta", "Gamma"],
        required_movies: [],
        runtime_overrides: {},
        target_movie_count: 3,
        plannable_movie_count: 3,
        sort_by: request.sort_by,
        secondary_sort_by: request.secondary_sort_by,
        earliest_start: null,
        latest_end: null,
        eligible_showings: 3,
        unplannable_showings: 0,
        missing_movies: [],
        missing_required_movies: [],
        total_itineraries: 1,
        offset: 0,
        limit: 25,
        has_more: false,
        minimum_buffer_minutes: 0,
        routing_available: true,
        itineraries: [
          {
            showtime_ids: ["alpha-standard", "beta-imax", "gamma-event"],
            movies: ["Alpha", "Beta", "Gamma"],
            dropped_movies: [],
            base_want_score: 6,
            experience_adjustment: 1,
            want_score: 7,
            starts_at: "2026-09-10T09:00:00",
            ends_at: "2026-09-10T13:00:00",
            home_at: "2026-09-10T13:00:00",
            elapsed_minutes: 240,
            movie_minutes: 180,
            travel_minutes: 0,
            waiting_minutes: 60,
            legs: [
              {
                from_showtime_id: "alpha-standard",
                to_showtime_id: "beta-imax",
                from_theatre: "AMC Center 8",
                to_theatre: "AMC Center 8",
                drive_minutes: 0,
                gap_minutes: 30,
                route_source_url: "",
              },
              {
                from_showtime_id: "beta-imax",
                to_showtime_id: "gamma-event",
                from_theatre: "AMC Center 8",
                to_theatre: "AMC Center 8",
                drive_minutes: 0,
                gap_minutes: 30,
                route_source_url: "",
              },
            ],
          },
        ],
      },
    });
  });
}

test("itinerary hides standard experience and highlights only scored deviations", async ({
  page,
}) => {
  await mockExperienceApi(page);
  await page.goto("/plan");
  await page.getByRole("button", { name: "Find itineraries" }).click();

  await expect(page.getByText("Want score 7 (+1 experience)")).toBeVisible();
  const alphaRow = page.locator(".showing-line", { hasText: "Alpha" });
  await expect(alphaRow).not.toContainText("Standard");
  await expect(alphaRow.locator(".experience-deviation")).toHaveCount(0);

  const imax = page.locator(".experience-deviation.positive", { hasText: "IMAX" });
  const fanEvent = page.locator(".experience-deviation.positive", { hasText: "Fan Event" });
  const noRecliners = page.locator(".experience-deviation.negative", {
    hasText: "No Signature Recliners",
  });
  await expect(imax).toContainText("+");
  await expect(fanEvent).toContainText("+");
  await expect(noRecliners).toContainText("−");

  const gammaRow = page.locator(".showing-line", { hasText: "Gamma" });
  await expect(gammaRow).not.toContainText("Standard");
  await expect(gammaRow.locator(".experience-deviation")).toHaveCount(2);
});
