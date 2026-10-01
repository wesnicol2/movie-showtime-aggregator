import { expect, test } from "@playwright/test";

function today(): string {
  const value = new Date();
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

test("Movie Day shows the expected home arrival for each itinerary option", async ({ page }) => {
  const date = today();
  await page.addInitScript(() => {
    localStorage.setItem("movie-showtime-aggregator.selected-movies.v1", JSON.stringify(["Alpha"]));
  });

  await page.route("**/api/screenings?*", async (route) => {
    await route.fulfill({
      json: {
        date,
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
        count: 1,
        total_count: 1,
        facets: {
          chains: ["AMC"],
          movies: ["Alpha"],
          theatres: ["AMC Center 8"],
          formats: ["Standard"],
        },
        screenings: [
          {
            showtime_id: `${date}-alpha`,
            movie: "Alpha",
            theatre: "AMC Center 8",
            chain: "AMC",
            format: "Standard",
            advertised_start: `${date}T08:35:00`,
            actual_start: `${date}T09:00:00`,
            estimated_end: `${date}T10:00:00`,
            runtime_minutes: 60,
            distance_miles: 4,
            purchase_url: "https://example.test/alpha",
            movie_source_id: "alpha",
            theatre_latitude: 33.45,
            theatre_longitude: -112.07,
            drive_to_minutes: 10,
            drive_home_minutes: 20,
            leave_home: `${date}T08:50:00`,
            home_arrival: `${date}T10:20:00`,
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
        ],
      },
    });
  });

  await page.route("**/api/movie-day", async (route) => {
    await route.fulfill({
      json: {
        date,
        selected_movies: ["Alpha"],
        required_movies: [],
        runtime_overrides: {},
        target_movie_count: 1,
        plannable_movie_count: 1,
        sort_by: "want",
        secondary_sort_by: "elapsed",
        earliest_start: null,
        latest_end: null,
        eligible_showings: 1,
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
            showtime_ids: [`${date}-alpha`],
            movies: ["Alpha"],
            dropped_movies: [],
            want_score: 1,
            starts_at: `${date}T09:00:00`,
            ends_at: `${date}T10:00:00`,
            home_at: `${date}T10:20:00`,
            elapsed_minutes: 90,
            movie_minutes: 60,
            travel_minutes: 30,
            waiting_minutes: 0,
            legs: [],
          },
        ],
      },
    });
  });

  await page.goto("/plan");
  await page.getByRole("button", { name: "Find combinations" }).click();

  await expect(page.getByText("Home at 10:20 AM")).toBeVisible();
});
