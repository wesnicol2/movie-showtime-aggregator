import { expect, type Page, test } from "@playwright/test";

const screeningsPayload = {
  date: "2026-09-06",
  market_zip: "85004",
  radius_miles: 15,
  location: { zip_code: "85004", radius_miles: 15 },
  preferences: {
    amc_vendor_key_set: false,
    omdb_api_key_set: true,
    amc_a_list: false,
    home_configured: true,
  },
  preview_minutes_by_chain: { AMC: 25 },
  enrichment_enabled: true,
  count: 2,
  total_count: 2,
  facets: {
    chains: ["AMC", "Harkins Theatres"],
    movies: ["Alpha", "Beta"],
    theatres: ["AMC Center 8", "Harkins Valley 14"],
    formats: ["IMAX", "Standard"],
  },
  screenings: [
    {
      showtime_id: "alpha-1",
      movie: "Alpha",
      theatre: "AMC Center 8",
      chain: "AMC",
      format: "IMAX",
      advertised_start: "2026-09-06T18:00:00",
      actual_start: "2026-09-06T18:25:00",
      estimated_end: "2026-09-06T20:25:00",
      runtime_minutes: 120,
      distance_miles: 4.2,
      purchase_url: "https://example.test/alpha",
      movie_source_id: "alpha",
      theatre_latitude: 33.45,
      theatre_longitude: -112.07,
      drive_to_minutes: 14,
      drive_home_minutes: 13,
      leave_home: "2026-09-06T18:11:00",
      home_arrival: "2026-09-06T20:38:00",
      poster_url: "",
      imdb_id: "tt0000001",
      imdb_rating: 8.1,
      metacritic_score: 77,
      rotten_tomatoes_score: 91,
      ticket_price: 0,
      seats_left_percent: 62,
      amc_a_list_eligible: true,
      amc_source_url: "https://example.test/amc-alpha",
      letterboxd_url: "https://example.test/letterboxd-alpha",
      imdb_url: "https://example.test/imdb-alpha",
      rotten_tomatoes_url: "https://example.test/rt-alpha",
      metacritic_url: "https://example.test/mc-alpha",
      route_source_url: "https://example.test/route-alpha",
    },
    {
      showtime_id: "beta-1",
      movie: "Beta",
      theatre: "Harkins Valley 14",
      chain: "Harkins Theatres",
      format: "Standard",
      advertised_start: "2026-09-06T19:15:00",
      actual_start: null,
      estimated_end: null,
      runtime_minutes: 105,
      distance_miles: 8.7,
      purchase_url: "https://example.test/beta",
      movie_source_id: "beta",
      theatre_latitude: 33.5,
      theatre_longitude: -112.1,
      drive_to_minutes: null,
      drive_home_minutes: null,
      leave_home: null,
      home_arrival: null,
      poster_url: "",
      imdb_id: "tt0000002",
      imdb_rating: 7.3,
      metacritic_score: 68,
      rotten_tomatoes_score: 84,
      ticket_price: null,
      seats_left_percent: null,
      amc_a_list_eligible: null,
      amc_source_url: "",
      letterboxd_url: "https://example.test/letterboxd-beta",
      imdb_url: "https://example.test/imdb-beta",
      rotten_tomatoes_url: "https://example.test/rt-beta",
      metacritic_url: "https://example.test/mc-beta",
      route_source_url: "",
    },
  ],
};

const settingsPayload = {
  home_address: "1 E Washington St, Phoenix, AZ",
  home_display_name: "1 E Washington St, Phoenix, Arizona",
  home_configured: true,
  amc_vendor_key_set: false,
  omdb_api_key_set: true,
  amc_a_list: false,
  provider_usage: {
    omdb: {
      requests_today: 12,
      cache_hits_today: 8,
      published_percent_used: 1.2,
      estimated_remaining_today: 988,
      app_counter_reset_at: "2026-09-07T00:00:00Z",
    },
    amc: {
      requests_today: 0,
      cache_hits_today: 0,
      app_counter_reset_at: "2026-09-07T00:00:00Z",
      provider_rate_limit: null,
    },
  },
};

async function mockApi(page: Page): Promise<() => number> {
  let screeningRequests = 0;
  await page.route("**/api/screenings?*", async (route) => {
    screeningRequests += 1;
    await route.fulfill({ json: screeningsPayload });
  });
  await page.route("**/api/settings", async (route) => {
    await route.fulfill({ json: settingsPayload });
  });
  return () => screeningRequests;
}

test("workstation navigation preserves shared loaded state", async ({ page }) => {
  const screeningRequestCount = await mockApi(page);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Screenings" })).toBeVisible();
  await expect(page.getByText("2 of 2 screenings")).toBeVisible();
  await expect(page.getByText("Alpha", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Movies" }).click();
  await expect(page.getByRole("heading", { name: "Choose movies" })).toBeVisible();
  await page.getByRole("button", { name: "Select Alpha" }).click();
  await expect(page.getByText("1 selected")).toBeVisible();

  await page.getByRole("button", { name: "Screenings" }).click();
  await expect(page.getByText("1 of 2 screenings")).toBeVisible();
  expect(screeningRequestCount()).toBe(1);

  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Theater search" })).toBeVisible();
});

test("direct SPA routes render from the production container", async ({ page }) => {
  await mockApi(page);

  await page.goto("/movies");
  await expect(page.getByRole("heading", { name: "Choose movies" })).toBeVisible();

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByText("Shared server").first()).toBeVisible();
});
