import { expect, type Page, test } from "@playwright/test";

function isoDate(daysFromToday = 0): string {
  const value = new Date();
  value.setHours(12, 0, 0, 0);
  value.setDate(value.getDate() + daysFromToday);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function screeningsFor(date: string) {
  return [
    {
      showtime_id: `${date}-alpha`,
      movie: "Alpha",
      theatre: "AMC Center 8",
      chain: "AMC",
      format: "Standard",
      advertised_start: `${date}T08:35:00`,
      actual_start: `${date}T09:00:00`,
      estimated_end: `${date}T11:00:00`,
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
      experience_deviations: [
        {
          id: "event:fan-event",
          label: "Fan Event",
          category: "event",
          polarity: "positive",
          score_delta: 1,
        },
      ],
      experience_score_adjustment: 1,
    },
    {
      showtime_id: `${date}-beta`,
      movie: "Beta",
      theatre: "Harkins Valley 12",
      chain: "Harkins",
      format: "Standard",
      advertised_start: `${date}T11:05:00`,
      actual_start: `${date}T11:30:00`,
      estimated_end: `${date}T13:10:00`,
      runtime_minutes: 100,
      distance_miles: 6,
      purchase_url: "https://example.test/beta",
      movie_source_id: "beta",
      theatre_latitude: 33.5,
      theatre_longitude: -112.1,
      drive_to_minutes: 12,
      drive_home_minutes: 12,
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
}

async function mockPlannerApi(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem(
      "movie-showtime-aggregator.selected-movies.v1",
      JSON.stringify(["Alpha", "Beta", "Gamma"]),
    );
  });

  await page.route("**/api/screenings?*", async (route) => {
    const url = new URL(route.request().url());
    const date = url.searchParams.get("date") ?? isoDate();
    const screenings = screeningsFor(date);
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
        preview_minutes_by_chain: { AMC: 25, Harkins: 15 },
        enrichment_enabled: url.searchParams.get("enrich") !== "0",
        count: screenings.length,
        total_count: screenings.length,
        facets: {
          chains: ["AMC", "Harkins"],
          movies: ["Alpha", "Beta"],
          theatres: ["AMC Center 8", "Harkins Valley 12"],
          formats: ["Standard"],
        },
        screenings,
      },
    });
  });

  await page.route("**/api/movie-day", async (route) => {
    const request = route.request().postDataJSON();
    const date = request.date as string;
    expect(request.movies).toEqual(["Alpha", "Beta"]);
    expect(request.sort_by).toBe("want");
    expect(request.secondary_sort_by).toBe("elapsed");
    await route.fulfill({
      json: {
        date,
        selected_movies: ["Alpha", "Beta"],
        required_movies: [],
        runtime_overrides: {},
        target_movie_count: 2,
        plannable_movie_count: 2,
        sort_by: request.sort_by,
        secondary_sort_by: request.secondary_sort_by,
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
            showtime_ids: [`${date}-alpha`, `${date}-beta`],
            movies: ["Alpha", "Beta"],
            dropped_movies: [],
            base_want_score: 3,
            experience_adjustment: 1,
            want_score: 4,
            starts_at: `${date}T09:00:00`,
            ends_at: `${date}T13:10:00`,
            elapsed_minutes: 250,
            movie_minutes: 220,
            travel_minutes: 15,
            waiting_minutes: 15,
            legs: [
              {
                from_showtime_id: `${date}-alpha`,
                to_showtime_id: `${date}-beta`,
                from_theatre: "AMC Center 8",
                to_theatre: "Harkins Valley 12",
                drive_minutes: 15,
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

test("Movie Day hides unavailable selected movies, deselects saved movies, and restores them when replanning", async ({
  page,
}) => {
  await mockPlannerApi(page);
  await page.goto("/plan");

  const priorityRows = page.locator("[data-movie-priority-row]");
  await expect(priorityRows).toHaveCount(2);
  await expect(priorityRows.filter({ hasText: "Alpha" })).toHaveCount(1);
  await expect(priorityRows.filter({ hasText: "Beta" })).toHaveCount(1);
  await expect(priorityRows.filter({ hasText: "Gamma" })).toHaveCount(0);
  await expect(page.getByLabel("Sort itineraries", { exact: true })).toHaveValue("want");
  await expect(page.getByLabel("Secondary sort itineraries")).toHaveValue("elapsed");

  await page.getByRole("button", { name: "Find combinations" }).click();
  await page.getByRole("button", { name: "Save option 1 to Planner" }).click();

  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem("movie-showtime-aggregator.selected-movies.v1") ?? "[]"),
      ),
    )
    .toEqual(["Gamma"]);

  await page.getByRole("button", { name: "Planner", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Movie planner" })).toBeVisible();
  await expect(page.getByText("1 planned day")).toBeVisible();
  await expect(page.getByText("2 planned movies")).toBeVisible();
  await expect(page.getByText("Showtimes still available")).toBeVisible();

  const today = page.locator(`[data-date="${isoDate()}"]`);
  await expect(today.getByText("Alpha", { exact: true })).toBeVisible();
  await expect(today.getByText("Beta", { exact: true })).toBeVisible();
  const savedEvent = today.locator(".experience-deviation.positive", { hasText: "Fan Event" });
  await expect(savedEvent).toContainText("+");

  await today.getByRole("button", { name: "Replan" }).click();
  await expect(page).toHaveURL(/\/plan$/);
  await expect(page.getByRole("heading", { name: "Plan a movie day" })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem("movie-showtime-aggregator.selected-movies.v1") ?? "[]"),
      ),
    )
    .toEqual(["Alpha", "Beta", "Gamma"]);
  await expect(priorityRows.filter({ hasText: "Alpha" })).toHaveCount(1);
  await expect(priorityRows.filter({ hasText: "Beta" })).toHaveCount(1);
});

test("Movie Day saved views restore planning controls without saving movie selection", async ({
  page,
}) => {
  await mockPlannerApi(page);
  await page.goto("/plan");

  await expect(page.getByLabel("Sort itineraries", { exact: true })).toHaveValue("want");
  await expect(page.getByLabel("Secondary sort itineraries")).toHaveValue("elapsed");
  await page.getByLabel("Number of movies").selectOption("1");
  await page.getByLabel("Movie day start").fill("17:00");
  await page.getByLabel("Movie day end").fill("23:30");
  await page.getByLabel("Extra transfer buffer").fill("15");
  await page.getByRole("button", { name: "Show showing filters" }).click();
  await page.getByRole("button", { name: "Filter by chain" }).click();
  await page.getByRole("checkbox", { name: "Harkins" }).uncheck();
  await page.getByRole("button", { name: "Close chain filter" }).click();

  page.once("dialog", (dialog) => void dialog.accept("After work"));
  await page.getByRole("button", { name: "Save view" }).click();

  const savedView = await page.evaluate(() => {
    const views = JSON.parse(
      localStorage.getItem("movie-showtime-aggregator.movie-day-saved-views.v1") ?? "{}",
    );
    return views["After work"];
  });
  expect(savedView.targetMovieCount).toBe(1);
  expect(savedView.earliestTime).toBe("17:00");
  expect(savedView.latestTime).toBe("23:30");
  expect(savedView.minimumBuffer).toBe(15);
  expect(savedView.facets.chains).toEqual(["AMC"]);
  expect(savedView.sortBy).toBe("want");
  expect(savedView.secondarySortBy).toBe("elapsed");
  expect(savedView.screeningView.filters.movie.selected).toBeNull();

  await page.getByLabel("Number of movies").selectOption("all");
  await page.getByLabel("Movie day start").fill("");
  await page.getByLabel("Movie day end").fill("");
  await page.getByLabel("Extra transfer buffer").fill("0");
  await page.getByRole("button", { name: "Filter by chain" }).click();
  await page.getByRole("button", { name: "All" }).click();
  await page.getByRole("button", { name: "Close chain filter" }).click();
  await page.getByLabel("Sort itineraries", { exact: true }).selectOption("driving");

  await page.getByLabel("Movie Day saved view").selectOption("After work");
  await expect(page.getByLabel("Number of movies")).toHaveValue("1");
  await expect(page.getByLabel("Movie day start")).toHaveValue("17:00");
  await expect(page.getByLabel("Movie day end")).toHaveValue("23:30");
  await expect(page.getByLabel("Extra transfer buffer")).toHaveValue("15");
  await expect(page.getByLabel("Sort itineraries", { exact: true })).toHaveValue("want");
  await expect(page.getByLabel("Secondary sort itineraries")).toHaveValue("elapsed");
  await expect(page.getByRole("button", { name: "Filter by chain" })).toContainText("AMC");
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem("movie-showtime-aggregator.selected-movies.v1") ?? "[]"),
      ),
    )
    .toEqual(["Alpha", "Beta", "Gamma"]);
});

test("jumping far enough forward extends the timeline and hands the date to Movie Day", async ({
  page,
}) => {
  await mockPlannerApi(page);
  const target = isoDate(48);
  await page.goto("/plan?view=planner");

  await page.getByLabel("Jump to date").fill(target);
  const targetDay = page.locator(`[data-date="${target}"]`);
  await expect(targetDay).toBeVisible();
  await targetDay.getByRole("button", { name: "Plan this day" }).click();

  await expect(page).toHaveURL(/\/plan$/);
  await expect(page.getByRole("heading", { name: "Plan a movie day" })).toBeVisible();
  await expect(page.getByLabel("Show date")).toHaveValue(target);
});
