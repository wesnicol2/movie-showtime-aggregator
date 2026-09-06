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
  count: 3,
  total_count: 3,
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
      initial_release_date: "2026-08-15",
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
      showtime_id: "alpha-2",
      movie: "Alpha",
      theatre: "Harkins Valley 14",
      chain: "Harkins Theatres",
      format: "Standard",
      advertised_start: "2026-09-06T20:30:00",
      actual_start: null,
      estimated_end: null,
      runtime_minutes: 120,
      distance_miles: 8.7,
      purchase_url: "https://example.test/alpha-harkins",
      movie_source_id: "alpha",
      theatre_latitude: 33.5,
      theatre_longitude: -112.1,
      drive_to_minutes: null,
      drive_home_minutes: null,
      leave_home: null,
      home_arrival: null,
      poster_url: "",
      imdb_id: "tt0000001",
      imdb_rating: 8.1,
      metacritic_score: 77,
      rotten_tomatoes_score: 91,
      initial_release_date: "2026-08-15",
      ticket_price: null,
      seats_left_percent: null,
      amc_a_list_eligible: null,
      amc_source_url: "",
      letterboxd_url: "https://example.test/letterboxd-alpha",
      imdb_url: "https://example.test/imdb-alpha",
      rotten_tomatoes_url: "https://example.test/rt-alpha",
      metacritic_url: "https://example.test/mc-alpha",
      route_source_url: "",
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
      initial_release_date: "1999-01-10",
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

async function mockApi(page: Page): Promise<void> {
  await page.route("**/api/screenings?*", async (route) => {
    await route.fulfill({ json: screeningsPayload });
  });
}

test("movie selection supports filtering and release-date sorting", async ({ page }) => {
  await mockApi(page);
  await page.goto("/movies");

  await page.getByLabel("Sort movies").selectOption("initial_release_date");
  await expect(
    page.getByRole("button", { name: "Select Alpha" }).getByText("Initial release · Aug 15, 2026"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Select Beta" }).getByText("Initial release · Jan 10, 1999"),
  ).toBeVisible();
  await expect(page.locator(".movie-tile").first()).toHaveAttribute("aria-label", "Select Alpha");

  await page.getByLabel("Filter titles").fill("Beta");
  await expect(page.getByRole("button", { name: "Select Beta" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Select Alpha" })).toHaveCount(0);

  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByLabel("Minimum IMDb").fill("8");
  await expect(page.getByRole("button", { name: "Select Alpha" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Select Beta" })).toHaveCount(0);
});

test("movie selection filters by actual theater and chain availability", async ({ page }) => {
  await mockApi(page);
  await page.goto("/movies");

  await page.getByLabel("Filter by theater").selectOption({ label: "AMC Center 8" });
  await expect(page.getByRole("button", { name: "Select Alpha" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Select Beta" })).toHaveCount(0);

  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByLabel("Filter by chain").selectOption({ label: "Harkins Theatres" });
  await expect(page.getByRole("button", { name: "Select Alpha" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Select Beta" })).toBeVisible();

  await page.getByLabel("Filter by theater").selectOption({ label: "AMC Center 8" });
  await expect(page.getByRole("button", { name: "Select Alpha" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Select Beta" })).toHaveCount(0);
});

test("saved views preserve the current movie selection instead of restoring a saved one", async ({
  page,
}) => {
  await mockApi(page);
  await page.goto("/movies");
  await page.getByRole("button", { name: "Select Alpha" }).click();

  await page.getByRole("button", { name: "Screenings" }).click();
  page.once("dialog", async (dialog) => dialog.accept("No movie selection"));
  await page.getByRole("button", { name: "Save view" }).click();

  await page.getByRole("button", { name: "Movies" }).click();
  await page.getByRole("button", { name: "Deselect Alpha" }).click();
  await page.getByRole("button", { name: "Select Beta" }).click();

  await page.getByRole("button", { name: "Screenings" }).click();
  await page.getByRole("combobox").first().selectOption({ label: "No movie selection" });
  await page.getByRole("button", { name: "Movies" }).click();

  await expect(page.getByRole("button", { name: "Deselect Beta" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Select Alpha" })).toBeVisible();
});
