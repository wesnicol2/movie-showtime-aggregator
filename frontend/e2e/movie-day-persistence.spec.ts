import { expect, type Page, test } from "@playwright/test";

const screenings = [
  {
    showtime_id: "alpha-1",
    movie: "Alpha",
    theatre: "AMC Center 8",
    chain: "AMC",
    format: "Standard",
    advertised_start: "2026-09-10T08:35:00",
    actual_start: "2026-09-10T09:00:00",
    estimated_end: "2026-09-10T11:00:00",
    runtime_minutes: 120,
    distance_miles: 4,
    purchase_url: "https://example.test/alpha",
    movie_source_id: "alpha",
    theatre_latitude: 33.45,
    theatre_longitude: -112.07,
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
  },
  {
    showtime_id: "beta-1",
    movie: "Beta",
    theatre: "AMC Valley 12",
    chain: "AMC",
    format: "Standard",
    advertised_start: "2026-09-10T11:05:00",
    actual_start: "2026-09-10T11:30:00",
    estimated_end: "2026-09-10T13:10:00",
    runtime_minutes: 100,
    distance_miles: 6,
    purchase_url: "https://example.test/beta",
    movie_source_id: "beta",
    theatre_latitude: 33.5,
    theatre_longitude: -112.1,
    drive_to_minutes: 15,
    drive_home_minutes: 15,
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
  },
];

async function mockApi(page: Page): Promise<() => number> {
  let movieDayRequests = 0;
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
    movieDayRequests += 1;
    const request = route.request().postDataJSON();
    await route.fulfill({
      json: {
        date: "2026-09-10",
        selected_movies: ["Alpha", "Beta"],
        required_movies: [],
        target_movie_count: request.target_movie_count,
        plannable_movie_count: 2,
        sort_by: request.sort_by,
        earliest_start: request.earliest_start,
        latest_end: request.latest_end,
        eligible_showings: 2,
        unplannable_showings: 0,
        missing_movies: [],
        missing_required_movies: [],
        total_itineraries: 1,
        offset: 0,
        limit: 25,
        has_more: false,
        minimum_buffer_minutes: request.minimum_buffer_minutes,
        routing_available: true,
        itineraries: [
          {
            showtime_ids: ["alpha-1"],
            movies: ["Alpha"],
            dropped_movies: ["Beta"],
            want_score: 2,
            starts_at: "2026-09-10T09:00:00",
            ends_at: "2026-09-10T11:00:00",
            elapsed_minutes: 120,
            movie_minutes: 120,
            travel_minutes: 0,
            waiting_minutes: 0,
            legs: [],
          },
        ],
      },
    });
  });
  return () => movieDayRequests;
}

test("Movie Day keeps in-progress controls and results across app navigation", async ({ page }) => {
  const movieDayRequestCount = await mockApi(page);
  await page.goto("/plan");

  await page.getByLabel("Number of movies").selectOption("1");
  await page.getByLabel("Movie day start").fill("09:00");
  await page.getByLabel("Movie day end").fill("14:00");
  await page.getByLabel("Sort itineraries").selectOption("driving");
  await page.getByLabel("Extra transfer buffer").fill("10");
  await page.getByRole("button", { name: "Find combinations" }).click();

  await expect(page.getByText("1 feasible 1-movie itineraries")).toBeVisible();
  expect(movieDayRequestCount()).toBe(1);

  await page.getByRole("button", { name: "Movies", exact: true }).click();
  await expect(page).toHaveURL(/\/movies$/);
  await page.getByRole("button", { name: "Movie Day", exact: true }).click();
  await expect(page).toHaveURL(/\/plan$/);

  await expect(page.getByLabel("Number of movies")).toHaveValue("1");
  await expect(page.getByLabel("Movie day start")).toHaveValue("09:00");
  await expect(page.getByLabel("Movie day end")).toHaveValue("14:00");
  await expect(page.getByLabel("Sort itineraries")).toHaveValue("driving");
  await expect(page.getByLabel("Extra transfer buffer")).toHaveValue("10");
  await expect(page.getByText("1 feasible 1-movie itineraries")).toBeVisible();
  await expect(page.getByText("OPTION 1")).toBeVisible();
  expect(movieDayRequestCount()).toBe(1);
});
