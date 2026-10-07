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
    showtime_id: "alpha-visual",
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
    showtime_id: "beta-visual",
    movie: "Beta",
    theatre: "AMC Valley 12",
    advertised_start: "2026-09-10T11:25:00",
    actual_start: "2026-09-10T11:50:00",
    estimated_end: "2026-09-10T13:30:00",
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
    await route.fulfill({
      json: {
        date: "2026-09-10",
        selected_movies: ["Alpha", "Beta"],
        required_movies: [],
        runtime_overrides: {},
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
            showtime_ids: ["alpha-visual", "beta-visual"],
            movies: ["Alpha", "Beta"],
            dropped_movies: [],
            want_score: 3,
            starts_at: "2026-09-10T09:00:00",
            ends_at: "2026-09-10T13:30:00",
            home_at: "2026-09-10T13:40:00",
            elapsed_minutes: 270,
            movie_minutes: 220,
            travel_minutes: 10,
            waiting_minutes: 40,
            legs: [
              {
                from_showtime_id: "alpha-visual",
                to_showtime_id: "beta-visual",
                from_theatre: "AMC Center 8",
                to_theatre: "AMC Valley 12",
                drive_minutes: 10,
                gap_minutes: 50,
                route_source_url: "https://example.test/route",
              },
            ],
          },
        ],
      },
    });
  });
}

test("planning results visualize movie, driving, and free time proportionally", async ({
  page,
}) => {
  await mockApi(page);
  await page.goto("/plan");
  await page.getByText("Advanced options", { exact: true }).click();
  await page.getByLabel("Number of movies").selectOption("all");
  await page.getByRole("button", { name: "Find itineraries" }).click();

  const visualization = page.locator(".itinerary-time-visualization");
  await expect(visualization).toBeVisible();
  await expect(visualization.locator('[data-time-kind="movie"]')).toHaveCount(2);

  const drive = visualization.locator('[data-time-kind="drive"]');
  const free = visualization.locator('[data-time-kind="free"]');
  await expect(drive).toHaveAttribute("data-minutes", "10");
  await expect(free).toHaveAttribute("data-minutes", "40");
  await expect(visualization).toHaveAttribute(
    "aria-label",
    /Driving 10 minutes, Free time 40 minutes/,
  );

  const driveWidth = await drive.evaluate((node) => node.getBoundingClientRect().width);
  const freeWidth = await free.evaluate((node) => node.getBoundingClientRect().width);
  expect(freeWidth).toBeGreaterThan(driveWidth);

  await expect(visualization.getByText("Movie time", { exact: true })).toBeVisible();
  await expect(visualization.getByText("Driving", { exact: true })).toBeVisible();
  await expect(visualization.getByText("Free time", { exact: true })).toBeVisible();
  await expect(visualization.getByText("Width represents time", { exact: true })).toBeVisible();
});
