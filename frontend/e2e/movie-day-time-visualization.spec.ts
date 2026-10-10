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

async function mockApi(
  page: Page,
  { driveMinutes = 10, gapMinutes = 50 }: { driveMinutes?: number; gapMinutes?: number } = {},
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
                drive_minutes: driveMinutes,
                gap_minutes: gapMinutes,
                route_source_url: "https://example.test/route",
              },
            ],
          },
        ],
      },
    });
  });
}

test("planning transfers visualize driving and spare time vertically between movies", async ({
  page,
}) => {
  await mockApi(page);
  await page.goto("/plan");
  await page.getByText("Advanced options", { exact: true }).click();
  await page.getByLabel("Number of movies").selectOption("all");
  await page.getByRole("button", { name: "Find itineraries" }).click();

  const card = page.locator(".itinerary-card");
  await expect(card.locator(".showing-line")).toHaveCount(2);
  await expect(card.locator(".itinerary-time-visualization")).toHaveCount(0);
  const transfer = card.locator(".transfer-line");
  await expect(transfer).toBeVisible();
  const drive = transfer.locator(".transfer-track-drive");
  const spare = transfer.locator(".transfer-track-free");
  await expect(transfer.getByRole("link", { name: "10 min drive" })).toHaveAttribute(
    "href",
    "https://example.test/route",
  );
  await expect(transfer.getByText("40 min spare")).toBeVisible();
  const driveHeight = await drive.evaluate((node) => node.getBoundingClientRect().height);
  const spareHeight = await spare.evaluate((node) => node.getBoundingClientRect().height);
  expect(spareHeight).toBeGreaterThan(driveHeight);

  const firstMovie = await card.locator(".showing-line").first().boundingBox();
  const lastMovie = await card.locator(".showing-line").last().boundingBox();
  const transferBox = await transfer.boundingBox();
  expect(firstMovie).not.toBeNull();
  expect(lastMovie).not.toBeNull();
  expect(transferBox).not.toBeNull();
  if (firstMovie && lastMovie && transferBox) {
    expect(transferBox.y).toBeGreaterThanOrEqual(firstMovie.y + firstMovie.height - 1);
    expect(transferBox.y + transferBox.height).toBeLessThanOrEqual(lastMovie.y + 1);
  }
});

test("same-theater transfers display only a gray spare-time segment", async ({ page }) => {
  await mockApi(page, { driveMinutes: 0, gapMinutes: 50 });
  await page.goto("/plan");
  await page.getByText("Advanced options", { exact: true }).click();
  await page.getByLabel("Number of movies").selectOption("all");
  await page.getByRole("button", { name: "Find itineraries" }).click();

  const transfer = page.locator(".itinerary-card .transfer-line");
  await expect(transfer.locator(".transfer-track-drive")).toHaveCount(0);
  await expect(transfer.locator(".transfer-track-free")).toHaveCount(1);
  await expect(transfer.locator(".transfer-track-free")).toHaveCSS(
    "background-color",
    "rgb(48, 56, 69)",
  );
  await expect(transfer.getByText("Same theater")).toBeVisible();
  await expect(transfer.getByText("50 min spare")).toBeVisible();
});

test("transfers without spare time display only gray driving", async ({ page }) => {
  await mockApi(page, { driveMinutes: 10, gapMinutes: 10 });
  await page.goto("/plan");
  await page.getByText("Advanced options", { exact: true }).click();
  await page.getByLabel("Number of movies").selectOption("all");
  await page.getByRole("button", { name: "Find itineraries" }).click();

  const transfer = page.locator(".itinerary-card .transfer-line");
  await expect(transfer.locator(".transfer-track-drive")).toHaveCount(1);
  await expect(transfer.locator(".transfer-track-free")).toHaveCount(0);
  await expect(transfer.locator(".transfer-track-drive")).toHaveCSS(
    "background-color",
    "rgb(48, 56, 69)",
  );
  await expect(transfer.getByRole("link", { name: "10 min drive" })).toBeVisible();
  await expect(transfer.getByText("0 min spare")).toBeVisible();
});
