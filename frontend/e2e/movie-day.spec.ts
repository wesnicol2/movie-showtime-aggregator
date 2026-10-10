import { expect, type Page, test } from "@playwright/test";
import type { Screening } from "../src/types";

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

async function mockApi(
  page: Page,
  movieMetadata: Record<string, Partial<Screening>> = {},
): Promise<void> {
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
        screenings: screenings.map((screening) => ({
          ...screening,
          ...movieMetadata[screening.movie],
        })),
      },
    });
  });
  await page.route("**/api/movie-day", async (route) => {
    const request = route.request().postDataJSON();
    expect(request.movies).toEqual(["Alpha", "Beta"]);
    expect(request.required_movies).toEqual([]);
    expect(request.runtime_overrides).toEqual({});
    expect(request.showtime_ids).toEqual(["alpha-1", "beta-1"]);
    expect(request.sort_by).toBe("want");
    expect(request.secondary_sort_by).toBe("elapsed");
    await route.fulfill({
      json: {
        date: "2026-09-10",
        selected_movies: ["Alpha", "Beta"],
        required_movies: [],
        runtime_overrides: request.runtime_overrides,
        target_movie_count: request.target_movie_count,
        plannable_movie_count: 2,
        sort_by: request.sort_by,
        secondary_sort_by: request.secondary_sort_by,
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
            showtime_ids: ["alpha-1", "beta-1"],
            movies: ["Alpha", "Beta"],
            dropped_movies: [],
            want_score: 3,
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

/** Restrict a checkbox filter to exactly `values`, then close its menu. */
async function keepOnly(page: Page, label: string, values: string[]): Promise<void> {
  await page.getByRole("button", { name: `Filter by ${label.toLowerCase()}` }).click();
  const menu = page.getByRole("dialog", { name: `${label} filter` });
  await menu.getByRole("button", { name: "None" }).click();
  for (const value of values) {
    await menu.getByRole("checkbox", { name: value, exact: true }).check();
  }
  await menu.getByRole("button", { name: `Close ${label.toLowerCase()} filter` }).click();
}

test("selected movies become a travel-aware movie-day itinerary", async ({ page }) => {
  await mockApi(page);
  await page.goto("/plan");
  await page.getByText("Advanced options", { exact: true }).click();

  await expect(page.getByRole("heading", { name: "Build your itinerary" })).toBeVisible();
  await expect(page.getByText("2 candidates", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show showing filters" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Filter by theater" })).toHaveCount(0);
  await page.getByLabel("Number of movies").selectOption("all");
  await page.getByLabel("Extra transfer buffer").fill("10");
  await page.getByRole("button", { name: "Find itineraries" }).click();

  await expect(page.getByText("1 feasible 2-movie itineraries")).toBeVisible();
  await expect(page.getByText("OPTION 1")).toBeVisible();
  await expect(page.getByText("Want score 3")).toBeVisible();
  await expect(page.getByText("15 min drive")).toBeVisible();
  await expect(page.getByText("15 min spare")).toBeVisible();
});

test("showing filters are collapsed and narrow the showings a plan may use", async ({ page }) => {
  await mockApi(page);
  await page.goto("/plan");
  await page.getByText("Advanced options", { exact: true }).click();
  await page.getByText("How this plan is scored", { exact: true }).click();
  await expect(page.getByText("2 candidate showings")).toBeVisible();
  await expect(page.getByText("0 active showing filters")).toBeVisible();
  await page.getByLabel("Number of movies").selectOption("all");

  await page.getByRole("button", { name: "Show showing filters" }).click();
  await keepOnly(page, "Theater", ["AMC Center 8"]);
  await expect(page.getByText("1 candidate showings")).toBeVisible();
  await expect(page.getByText("1 active showing filters")).toBeVisible();
  await expect(page.locator(".movie-day-filter-count")).toHaveText("1");

  await page.getByRole("button", { name: "Hide showing filters" }).click();
  await expect(page.getByRole("button", { name: "Filter by theater" })).toHaveCount(0);

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
        minimum_buffer_minutes: request.minimum_buffer_minutes,
        routing_available: true,
        itineraries: [],
      },
    });
  });
  await page.getByRole("button", { name: "Find itineraries" }).click();
  await expect(page.getByText(/Only 1 candidate movie has an eligible showing/)).toBeVisible();

  await page.getByRole("button", { name: "Show showing filters" }).click();
  await page.getByRole("button", { name: "Clear showing filters" }).click();
  await expect(page.getByText("2 candidate showings")).toBeVisible();
  await expect(page.getByText("0 active showing filters")).toBeVisible();
});

test("planner sends exact count, time bounds, primary sort, and secondary sort", async ({
  page,
}) => {
  await mockApi(page);
  await page.goto("/plan");
  await page.getByText("Advanced options", { exact: true }).click();

  await page.getByRole("button", { name: "Filter by movies" }).click();
  const movieMenu = page.getByRole("dialog", { name: "Movies filter" });
  await movieMenu.getByRole("checkbox", { name: "Beta", exact: true }).uncheck();
  await expect(page.getByText("1 candidate", { exact: true })).toBeVisible();
  await movieMenu.getByRole("checkbox", { name: "Beta", exact: true }).check();
  await movieMenu.getByRole("button", { name: "Close movies filter" }).click();
  await expect(page.getByText("2 candidates", { exact: true })).toBeVisible();

  await page.getByLabel("Number of movies").selectOption("1");
  await page.getByLabel("Movie day start").fill("09:00");
  await page.getByLabel("Movie day end").fill("14:00");
  await page.getByLabel("Sort itineraries", { exact: true }).selectOption("home");
  await page.getByLabel("Secondary sort itineraries").selectOption("want");

  await page.route("**/api/movie-day", async (route) => {
    const request = route.request().postDataJSON();
    expect(request.movies).toEqual(["Alpha", "Beta"]);
    expect(request.required_movies).toEqual([]);
    expect(request.runtime_overrides).toEqual({});
    expect(request.target_movie_count).toBe(1);
    expect(request.sort_by).toBe("home");
    expect(request.secondary_sort_by).toBe("want");
    expect(request.earliest_start).toBe("2026-09-10T09:00:00");
    expect(request.latest_end).toBe("2026-09-10T14:00:00");
    await route.fulfill({
      json: {
        date: "2026-09-10",
        selected_movies: ["Alpha", "Beta"],
        required_movies: [],
        runtime_overrides: {},
        target_movie_count: 1,
        plannable_movie_count: 2,
        sort_by: "home",
        secondary_sort_by: "want",
        earliest_start: request.earliest_start,
        latest_end: request.latest_end,
        eligible_showings: 2,
        unplannable_showings: 0,
        missing_movies: [],
        missing_required_movies: [],
        total_itineraries: 2,
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

  await page.getByRole("button", { name: "Find itineraries" }).click();
  await expect(page.getByText("Skipped: Beta")).toBeVisible();
  await expect(page.getByText("Earliest home first; ties by highest want score")).toBeVisible();
});

test("movie priorities and pins are sent as hard planner constraints", async ({ page }) => {
  await mockApi(page);
  await page.goto("/plan");
  await page.getByText("Advanced options", { exact: true }).click();
  await page.getByText("Movie priorities & runtimes", { exact: true }).click();

  await page.getByRole("button", { name: "Move Beta up" }).click();
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
            dropped_movies: ["Alpha"],
            want_score: 2,
            starts_at: "2026-09-10T11:30:00",
            ends_at: "2026-09-10T13:10:00",
            elapsed_minutes: 100,
            movie_minutes: 100,
            travel_minutes: 0,
            waiting_minutes: 0,
            legs: [],
          },
        ],
      },
    });
  });

  await page.getByRole("button", { name: "Find itineraries" }).click();
  await expect(page.getByText("Highest want score first; ties by minimum time")).toBeVisible();
  await expect(page.getByText("Want score 2")).toBeVisible();
  await expect(page.getByText("Skipped: Alpha")).toBeVisible();
});

test("manual runtimes are persisted and sent to the planner", async ({ page }) => {
  await mockApi(page);
  await page.goto("/plan");
  await page.getByText("Advanced options", { exact: true }).click();
  await page.getByText("Movie priorities & runtimes", { exact: true }).click();

  const runtimeInput = page.getByLabel("Alpha runtime minutes");
  await expect(runtimeInput).toHaveAttribute("placeholder", "120");
  await runtimeInput.fill("95");
  await page.getByText("How this plan is scored", { exact: true }).click();
  await expect(page.getByText("1 runtime overrides")).toBeVisible();
  await page.getByLabel("Number of movies").selectOption("1");

  await page.route("**/api/movie-day", async (route) => {
    const request = route.request().postDataJSON();
    expect(request.runtime_overrides).toEqual({ Alpha: 95 });
    expect(request.sort_by).toBe("want");
    expect(request.secondary_sort_by).toBe("elapsed");
    await route.fulfill({
      json: {
        date: "2026-09-10",
        selected_movies: ["Alpha", "Beta"],
        required_movies: [],
        runtime_overrides: { Alpha: 95 },
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
        total_itineraries: 2,
        offset: 0,
        limit: 25,
        has_more: false,
        minimum_buffer_minutes: 0,
        routing_available: true,
        itineraries: [
          {
            showtime_ids: ["alpha-1"],
            movies: ["Alpha"],
            dropped_movies: ["Beta"],
            want_score: 2,
            starts_at: "2026-09-10T09:00:00",
            ends_at: "2026-09-10T10:35:00",
            elapsed_minutes: 95,
            movie_minutes: 95,
            travel_minutes: 0,
            waiting_minutes: 0,
            legs: [],
          },
        ],
      },
    });
  });

  await page.getByRole("button", { name: "Find itineraries" }).click();
  await expect(page.getByText("95 min · manual")).toBeVisible();

  await page.reload();
  await page.getByText("Movie priorities & runtimes", { exact: true }).click();
  await expect(page.getByLabel("Alpha runtime minutes")).toHaveValue("95");
});

test("priority rows link ratings and fetch Letterboxd only when expanded", async ({ page }) => {
  await mockApi(page, {
    Alpha: {
      imdb_id: "tt1234567",
      letterboxd_url: "https://letterboxd.com/imdb/tt1234567/",
      rotten_tomatoes_score: 87,
      rotten_tomatoes_url: "https://www.rottentomatoes.com/m/alpha",
      metacritic_score: 74,
      metacritic_url: "https://www.metacritic.com/movie/alpha/",
    },
  });
  let requests = 0;
  await page.route("**/api/letterboxd-rating?*", async (route) => {
    requests += 1;
    await route.fulfill({ json: { rating: 4.15 } });
  });
  await page.goto("/plan");
  expect(requests).toBe(0);
  await page.getByText("Movie priorities & runtimes", { exact: true }).click();

  const first = page.locator(".movie-priority-list li").first();
  await expect(first.getByRole("link", { name: "Rotten Tomatoes 87%" })).toHaveAttribute(
    "href",
    "https://www.rottentomatoes.com/m/alpha",
  );
  await expect(first.getByRole("link", { name: "Metacritic 74/100" })).toBeVisible();
  await expect(first.getByRole("link", { name: "Letterboxd 4.15/5" })).toHaveAttribute(
    "href",
    "https://letterboxd.com/imdb/tt1234567/",
  );
  expect(requests).toBe(1);
  await expect(page.getByText("Letterboxd —")).toBeVisible();
});

test("transfer timeline is vertical between movie rows with proportional segments", async ({
  page,
}) => {
  await mockApi(page);
  await page.goto("/plan");
  await page.getByText("Advanced options", { exact: true }).click();
  await page.getByLabel("Number of movies").selectOption("all");
  await page.getByRole("button", { name: "Find itineraries" }).click();

  await expect(page.locator(".itinerary-time-track")).toHaveCount(0);
  const transfer = page.locator(".itinerary-card .transfer-line");
  await expect(transfer).toHaveCount(1);
  await expect(transfer.getByRole("link", { name: "15 min drive" })).toBeVisible();
  await expect(transfer.getByText("15 min spare")).toBeVisible();
  await expect(transfer.locator(".transfer-track-drive")).toHaveAttribute("style", "height: 24px;");
  await expect(transfer.locator(".transfer-track-free")).toHaveAttribute("style", "height: 24px;");
});
