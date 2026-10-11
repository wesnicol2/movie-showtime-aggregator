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
  {
    driveMinutes = 10,
    gapMinutes = 50,
    compareTransfers = false,
  }: { driveMinutes?: number; gapMinutes?: number; compareTransfers?: boolean } = {},
): Promise<void> {
  await page.addInitScript(
    (movies) => {
      localStorage.setItem("movie-showtime-aggregator.selected-movies.v1", JSON.stringify(movies));
    },
    compareTransfers ? ["Alpha", "Beta", "Gamma"] : ["Alpha", "Beta"],
  );
  const exampleScreenings = compareTransfers
    ? [
        screenings[0],
        {
          ...screenings[1],
          actual_start: "2026-09-10T11:30:00",
          estimated_end: "2026-09-10T13:10:00",
        },
        {
          ...screenings[1],
          showtime_id: "gamma-visual",
          movie: "Gamma",
          actual_start: "2026-09-10T14:20:00",
          estimated_end: "2026-09-10T16:00:00",
        },
      ]
    : screenings;

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
        count: exampleScreenings.length,
        total_count: exampleScreenings.length,
        facets: {
          chains: ["AMC"],
          movies: compareTransfers ? ["Alpha", "Beta", "Gamma"] : ["Alpha", "Beta"],
          theatres: ["AMC Center 8", "AMC Valley 12"],
          formats: ["Standard"],
        },
        screenings: exampleScreenings,
      },
    });
  });

  await page.route("**/api/movie-day", async (route) => {
    const request = route.request().postDataJSON();
    await route.fulfill({
      json: {
        date: "2026-09-10",
        selected_movies: compareTransfers ? ["Alpha", "Beta", "Gamma"] : ["Alpha", "Beta"],
        required_movies: [],
        runtime_overrides: {},
        target_movie_count: request.target_movie_count,
        plannable_movie_count: exampleScreenings.length,
        sort_by: request.sort_by,
        secondary_sort_by: request.secondary_sort_by,
        earliest_start: request.earliest_start,
        latest_end: request.latest_end,
        eligible_showings: exampleScreenings.length,
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
            showtime_ids: compareTransfers
              ? ["alpha-visual", "beta-visual", "gamma-visual"]
              : ["alpha-visual", "beta-visual"],
            movies: compareTransfers ? ["Alpha", "Beta", "Gamma"] : ["Alpha", "Beta"],
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
                drive_minutes: compareTransfers ? 10 : driveMinutes,
                gap_minutes: compareTransfers ? 30 : gapMinutes,
                route_source_url: "https://example.test/route",
              },
              ...(compareTransfers
                ? [
                    {
                      from_showtime_id: "beta-visual",
                      to_showtime_id: "gamma-visual",
                      from_theatre: "AMC Valley 12",
                      to_theatre: "AMC Valley 12",
                      drive_minutes: 10,
                      gap_minutes: 70,
                      route_source_url: "https://example.test/route",
                    },
                  ]
                : []),
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
  expect(spareHeight / driveHeight).toBeCloseTo(4, 2);

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

test("10 minutes driving and 20 minutes waiting occupy a one-third/two-thirds split", async ({
  page,
}) => {
  await mockApi(page, { driveMinutes: 10, gapMinutes: 30 });
  await page.goto("/plan");
  await page.getByText("Advanced options", { exact: true }).click();
  await page.getByLabel("Number of movies").selectOption("all");
  await page.getByRole("button", { name: "Find itineraries" }).click();

  const transfer = page.locator(".itinerary-card .transfer-line");
  const drive = transfer.locator(".transfer-track-drive");
  const spare = transfer.locator(".transfer-track-free");
  await expect(transfer.getByRole("link", { name: "10 min drive" })).toBeVisible();
  await expect(transfer.getByText("20 min spare")).toBeVisible();

  const driveHeight = await drive.evaluate((node) => node.getBoundingClientRect().height);
  const spareHeight = await spare.evaluate((node) => node.getBoundingClientRect().height);
  expect(driveHeight / (driveHeight + spareHeight)).toBeCloseTo(1 / 3, 2);
  expect(spareHeight / (driveHeight + spareHeight)).toBeCloseTo(2 / 3, 2);
});

test("a 60-minute wait is taller than a 20-minute wait in the same itinerary", async ({ page }) => {
  await mockApi(page, { compareTransfers: true });
  await page.goto("/plan");
  await page.getByText("Advanced options", { exact: true }).click();
  await page.getByLabel("Number of movies").selectOption("all");
  await page.getByRole("button", { name: "Find itineraries" }).click();

  const transfers = page.locator(".itinerary-card .transfer-line");
  await expect(transfers).toHaveCount(2);
  await expect(transfers.nth(0).getByText("20 min spare")).toBeVisible();
  await expect(transfers.nth(1).getByText("60 min spare")).toBeVisible();

  const shortWait = await transfers
    .nth(0)
    .locator(".transfer-track-free")
    .evaluate((node) => node.getBoundingClientRect().height);
  const longWait = await transfers
    .nth(1)
    .locator(".transfer-track-free")
    .evaluate((node) => node.getBoundingClientRect().height);
  const shortTrack = await transfers
    .nth(0)
    .locator(".transfer-track")
    .evaluate((node) => node.getBoundingClientRect().height);
  const longTrack = await transfers
    .nth(1)
    .locator(".transfer-track")
    .evaluate((node) => node.getBoundingClientRect().height);

  expect(longWait).toBeGreaterThan(shortWait * 1.5);
  expect(longTrack).toBeGreaterThan(shortTrack);
  expect(longTrack).toBeLessThan(shortTrack * 2);
  // The leg-local split remains proportional even when neighboring gaps differ.
  expect(shortWait / shortTrack).toBeCloseTo(2 / 3, 2);
  expect(longWait / longTrack).toBeCloseTo(6 / 7, 2);
});
