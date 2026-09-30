import { expect, type Page, test } from "@playwright/test";

const screeningFixture = [
  {
    showtime_id: "alpha-1",
    movie: "Alpha",
    chain: "AMC",
    theatre: "AMC Center 8",
    format: "Standard",
    advertised_start: "2026-09-10T08:35:00",
    actual_start: "2026-09-10T09:00:00",
    estimated_end: "2026-09-10T11:00:00",
    runtime_minutes: 120,
    distance_miles: 4,
    movie_source_id: "alpha",
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
    purchase_url: "https://example.test/alpha",
    letterboxd_url: "",
    imdb_url: "",
    rotten_tomatoes_url: "",
    metacritic_url: "",
    route_source_url: "",
    theatre_latitude: 33.45,
    theatre_longitude: -112.07,
  },
  {
    showtime_id: "beta-1",
    movie: "Beta",
    chain: "Harkins",
    theatre: "Harkins Valley 16",
    format: "IMAX",
    advertised_start: "2026-09-10T11:15:00",
    actual_start: "2026-09-10T11:35:00",
    estimated_end: "2026-09-10T13:35:00",
    runtime_minutes: 120,
    distance_miles: 8,
    movie_source_id: "beta",
    drive_to_minutes: 18,
    drive_home_minutes: 18,
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
    purchase_url: "https://example.test/beta",
    letterboxd_url: "",
    imdb_url: "",
    rotten_tomatoes_url: "",
    metacritic_url: "",
    route_source_url: "",
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
    localStorage.removeItem("movie-showtime-aggregator.movie-day-preferences.v1");
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
        preview_minutes_by_chain: { AMC: 25, Harkins: 20 },
        enrichment_enabled: true,
        count: screeningFixture.length,
        total_count: screeningFixture.length,
        facets: {
          chains: ["AMC", "Harkins"],
          movies: ["Alpha", "Beta"],
          theatres: ["AMC Center 8", "Harkins Valley 16"],
          formats: ["Standard", "IMAX"],
        },
        screenings: screeningFixture,
      },
    });
  });
}

test("selected movies become a travel-aware movie-day itinerary", async ({ page }) => {
  await mockApi(page);
  await page.goto("/plan");

  await page.route("**/api/movie-day", async (route) => {
    await route.fulfill({
      json: {
        date: "2026-09-10",
        selected_movies: ["Alpha", "Beta"],
        required_movies: [],
        runtime_overrides: {},
        target_movie_count: 2,
        plannable_movie_count: 2,
        sort_by: "elapsed",
        secondary_sort_by: "driving",
        earliest_start: null,
        latest_end: null,
        eligible_showings: 2,
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
            showtime_ids: ["alpha-1", "beta-1"],
            movies: ["Alpha", "Beta"],
            start_time: "2026-09-10T09:00:00",
            end_time: "2026-09-10T13:35:00",
            elapsed_minutes: 275,
            driving_minutes: 22,
            want_score: 3,
            legs: [],
          },
        ],
      },
    });
  });

  await page.getByRole("button", { name: "Find combinations" }).click();
  await expect(page.getByText("Alpha → Beta")).toBeVisible();
});

test("showing filters are collapsed and narrow the showings a plan may use", async ({ page }) => {
  await mockApi(page);
  await page.goto("/plan");

  await expect(page.getByLabel("Theater")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Filters/ })).toBeVisible();
  await page.getByRole("button", { name: /^Filters/ }).click();
  await page.getByLabel("Theater").click();
  await page.getByLabel("AMC Center 8").check();
  await expect(page.getByRole("button", { name: /Filters.*1 active/ })).toBeVisible();

  await page.route("**/api/movie-day", async (route) => {
    const request = route.request().postDataJSON();
    expect(request.showtime_ids).toEqual(["alpha-1"]);
    await route.fulfill({
      json: {
        date: "2026-09-10",
        selected_movies: ["Alpha", "Beta"],
        required_movies: [],
        runtime_overrides: {},
        target_movie_count: 2,
        plannable_movie_count: 1,
        sort_by: "elapsed",
        secondary_sort_by: "driving",
        earliest_start: null,
        latest_end: null,
        eligible_showings: 1,
        unplannable_showings: 0,
        missing_movies: ["Beta"],
        missing_required_movies: [],
        total_itineraries: 0,
        offset: 0,
        limit: 25,
        has_more: false,
        minimum_buffer_minutes: 0,
        routing_available: true,
        itineraries: [],
      },
    });
  });

  await page.getByRole("button", { name: "Find combinations" }).click();
  await expect(page.getByText("No combinations match these constraints.")).toBeVisible();

  await page.getByRole("button", { name: /^Filters/ }).click();
  await expect(page.getByLabel("Theater")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Filters.*1 active/ })).toBeVisible();
});

test("planner sends exact count, time bounds, primary sort, and secondary sort", async ({ page }) => {
  await mockApi(page);
  await page.goto("/plan");

  await page.getByLabel("Number of movies").selectOption("1");
  await page.getByLabel("Start no earlier than").fill("09:15");
  await page.getByLabel("Finish no later than").fill("14:00");
  await page.getByLabel("Sort itineraries", { exact: true }).selectOption("driving");
  await page.getByLabel("Secondary sort itineraries").selectOption("want");

  await page.route("**/api/movie-day", async (route) => {
    const request = route.request().postDataJSON();
    expect(request.target_movie_count).toBe(1);
    expect(request.earliest_start).toBe("2026-09-10T09:15:00");
    expect(request.latest_end).toBe("2026-09-10T14:00:00");
    expect(request.sort_by).toBe("driving");
    expect(request.secondary_sort_by).toBe("want");
    await route.fulfill({
      json: {
        date: "2026-09-10",
        selected_movies: ["Alpha", "Beta"],
        required_movies: [],
        runtime_overrides: {},
        target_movie_count: 1,
        plannable_movie_count: 2,
        sort_by: "driving",
        secondary_sort_by: "want",
        earliest_start: "2026-09-10T09:15:00",
        latest_end: "2026-09-10T14:00:00",
        eligible_showings: 2,
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
            showtime_ids: ["alpha-1"],
            movies: ["Alpha"],
            start_time: "2026-09-10T09:15:00",
            end_time: "2026-09-10T11:00:00",
            elapsed_minutes: 105,
            driving_minutes: 10,
            want_score: 2,
            legs: [],
          },
        ],
      },
    });
  });

  await page.getByRole("button", { name: "Find combinations" }).click();
  await expect(page.getByText("Minimum driving first; ties by highest want score")).toBeVisible();
});

test("movie priorities and pins are sent as hard planner constraints", async ({ page }) => {
  await mockApi(page);
  await page.goto("/plan");

  await page.getByRole("button", { name: "Send Beta to top" }).click();
  await page.getByRole("button", { name: "Pin Beta" }).click();
  await expect(page.getByRole("button", { name: "Unpin Beta" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByLabel("Number of movies").selectOption("1");
  await page.getByLabel("Sort itineraries", { exact: true }).selectOption("want");

  await page.route("**/api/movie-day", async (route) => {
    const request = route.request().postDataJSON();
    expect(request.movies).toEqual(["Beta", "Alpha"]);
    expect(request.required_movies).toEqual(["Beta"]);
    expect(request.runtime_overrides).toEqual({});
    expect(request.target_movie_count).toBe(1);
    expect(request.sort_by).toBe("want");
    expect(request.secondary_sort_by).toBe("elapsed");
    await route.fulfill({
      json: {
        date: "2026-09-10",
        selected_movies: ["Beta", "Alpha"],
        required_movies: ["Beta"],
        runtime_overrides: {},
        target_movie_count: 1,
        plannable_movie_count: 2,
        sort_by: "want",
        secondary_sort_by: "elapsed",
        earliest_start: null,
        latest_end: null,
        eligible_showings: 2,
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
            showtime_ids: ["beta-1"],
            movies: ["Beta"],
            start_time: "2026-09-10T11:35:00",
            end_time: "2026-09-10T13:35:00",
            elapsed_minutes: 120,
            driving_minutes: 18,
            want_score: 2,
            legs: [],
          },
        ],
      },
    });
  });

  await page.getByRole("button", { name: "Find combinations" }).click();
  await expect(page.getByText("Beta")).toBeVisible();
});

test("manual runtimes are persisted and sent to the planner", async ({ page }) => {
  await mockApi(page);
  await page.goto("/plan");

  await page.getByLabel("Alpha runtime minutes").fill("135");
  await expect(page.getByText("Manual override")).toBeVisible();

  await page.route("**/api/movie-day", async (route) => {
    const request = route.request().postDataJSON();
    expect(request.runtime_overrides).toEqual({ Alpha: 135 });
    await route.fulfill({
      json: {
        date: "2026-09-10",
        selected_movies: ["Alpha", "Beta"],
        required_movies: [],
        runtime_overrides: { Alpha: 135 },
        target_movie_count: 2,
        plannable_movie_count: 2,
        sort_by: "elapsed",
        secondary_sort_by: "driving",
        earliest_start: null,
        latest_end: null,
        eligible_showings: 2,
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
            showtime_ids: ["alpha-1", "beta-1"],
            movies: ["Alpha", "Beta"],
            start_time: "2026-09-10T09:00:00",
            end_time: "2026-09-10T13:35:00",
            elapsed_minutes: 275,
            driving_minutes: 22,
            want_score: 3,
            legs: [],
          },
        ],
      },
    });
  });

  await page.getByRole("button", { name: "Find combinations" }).click();
  await expect(page.getByText("Alpha → Beta")).toBeVisible();
});
