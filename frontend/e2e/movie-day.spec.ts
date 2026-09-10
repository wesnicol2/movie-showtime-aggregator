import { expect, type Page, test } from "@playwright/test";

const baseScreening = {
  chain: "AMC",
  format: "Standard",
  distance_miles: 4,
  movie_source_id: "movie",
  drive_to_minutes: 10,
  drive_home_minutes: 10,
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
};

const screenings = [
  {
    ...baseScreening,
    showtime_id: "alpha-1",
    movie: "Alpha",
    theatre: "AMC Center 8",
    advertised_start: "2026-09-10T08:35:00",
    actual_start: "2026-09-10T09:00:00",
    estimated_end: "2026-09-10T11:00:00",
    runtime_minutes: 120,
    purchase_url: "https://example.test/alpha",
    theatre_latitude: 33.45,
    theatre_longitude: -112.07,
  },
  {
    ...baseScreening,
    showtime_id: "beta-1",
    movie: "Beta",
    theatre: "AMC Valley 12",
    advertised_start: "2026-09-10T11:05:00",
    actual_start: "2026-09-10T11:30:00",
    estimated_end: "2026-09-10T13:10:00",
    runtime_minutes: 100,
    purchase_url: "https://example.test/beta",
    theatre_latitude: 33.5,
    theatre_longitude: -112.1,
  },
];

async function mockApi(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem(
      "movie-showtime-aggregator.selected-movies.v1",
      JSON.stringify(["Alpha", "Beta"]),
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
        count: 2,
        total_count: 2,
        facets: {
          chains: ["AMC"],
          movies: ["Alpha", "Beta"],
          theatres: ["AMC Center 8", "AMC Valley 12"],
          formats: ["Standard"],
        },
        screenings,
      },
    });
  });
  await page.route("**/api/movie-day", async (route) => {
    const request = route.request().postDataJSON();
    expect(request.movies).toEqual(["Alpha", "Beta"]);
    expect(request.showtime_ids).toEqual(["alpha-1", "beta-1"]);
    await route.fulfill({
      json: {
        date: "2026-09-10",
        selected_movies: ["Alpha", "Beta"],
        eligible_showings: 2,
        unplannable_showings: 0,
        missing_movies: [],
        total_itineraries: 1,
        offset: 0,
        limit: 25,
        has_more: false,
        minimum_buffer_minutes: request.minimum_buffer_minutes,
        routing_available: true,
        itineraries: [
          {
            showtime_ids: ["alpha-1", "beta-1"],
            starts_at: "2026-09-10T09:00:00",
            ends_at: "2026-09-10T13:10:00",
            elapsed_minutes: 250,
            movie_minutes: 220,
            travel_minutes: 15,
            waiting_minutes: 15,
            legs: [
              {
                from_showtime_id: "alpha-1",
                to_showtime_id: "beta-1",
                from_theatre: "AMC Center 8",
                to_theatre: "AMC Valley 12",
                drive_minutes: 15,
                gap_minutes: 30,
                route_source_url:
                  "https://www.openstreetmap.org/directions?engine=fossgis_osrm_car",
              },
            ],
          },
        ],
      },
    });
  });
}

test("selected movies become a travel-aware movie-day itinerary", async ({ page }) => {
  await mockApi(page);
  await page.goto("/plan");

  await expect(page.getByRole("heading", { name: "Plan a movie day" })).toBeVisible();
  await expect(page.getByText("Alpha", { exact: true })).toBeVisible();
  await expect(page.getByText("Beta", { exact: true })).toBeVisible();
  await page.getByLabel("Extra transfer buffer").fill("10");
  await page.getByRole("button", { name: "Find combinations" }).click();

  await expect(page.getByText("1 feasible combinations")).toBeVisible();
  await expect(page.getByText("OPTION 1")).toBeVisible();
  await expect(page.getByText("15 min drive")).toBeVisible();
  await expect(page.getByText("15 min spare")).toBeVisible();
});
