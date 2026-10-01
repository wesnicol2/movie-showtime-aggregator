import { expect, type Page, test } from "@playwright/test";

const date = "2026-09-30";
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
  metacritic_score: null,
  rotten_tomatoes_score: null,
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
    advertised_start: `${date}T17:00:00`,
    actual_start: `${date}T17:25:00`,
    estimated_end: `${date}T19:25:00`,
    runtime_minutes: 120,
    purchase_url: "https://example.test/alpha",
    theatre_latitude: 33.45,
    theatre_longitude: -112.07,
    imdb_rating: 8.2,
    initial_release_date: "2026-09-01",
  },
  {
    ...baseScreening,
    showtime_id: "beta-1",
    movie: "Beta",
    theatre: "AMC Center 8",
    advertised_start: `${date}T20:00:00`,
    actual_start: `${date}T20:25:00`,
    estimated_end: `${date}T22:05:00`,
    runtime_minutes: 100,
    purchase_url: "https://example.test/beta",
    theatre_latitude: 33.45,
    theatre_longitude: -112.07,
    imdb_rating: 7.1,
    initial_release_date: "2026-09-15",
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
        date,
        market_zip: "85004",
        radius_miles: 25,
        location: { zip_code: "85004", radius_miles: 25 },
        preferences: {
          amc_vendor_key_set: false,
          omdb_api_key_set: true,
          amc_a_list: false,
          home_configured: true,
        },
        preview_minutes_by_chain: { AMC: 25 },
        enrichment_enabled: true,
        count: screenings.length,
        total_count: screenings.length,
        facets: {
          chains: ["AMC"],
          movies: ["Alpha", "Beta"],
          theatres: ["AMC Center 8"],
          formats: ["Standard"],
        },
        screenings,
      },
    });
  });
}

async function saveNamedView(page: Page, name: string): Promise<void> {
  page.once("dialog", async (dialog) => dialog.accept(name));
  await page.getByRole("button", { name: "Save view" }).click();
}

test("Movie Selection saves reusable views and restores its chosen default", async ({ page }) => {
  await mockApi(page);
  await page.goto("/movies");

  await page.getByRole("button", { name: "Show movie filters" }).click();
  await page.getByLabel("Filter titles").fill("Beta");
  await page.getByLabel("Sort movies").selectOption("imdb_rating");
  await saveNamedView(page, "Late picks");
  await page.getByRole("button", { name: "Set default" }).click();
  await expect(page.getByRole("button", { name: "Default ✓" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.reload();

  await expect(page.getByLabel("Movie saved view")).toHaveValue("Late picks");
  await expect(page.getByLabel("Sort movies")).toHaveValue("imdb_rating");
  await page.getByRole("button", { name: "Show movie filters" }).click();
  await expect(page.getByLabel("Filter titles")).toHaveValue("Beta");
  await expect(
    page.evaluate(() => localStorage.getItem("movie-showtime-aggregator.selected-movies.v1")),
  ).resolves.toBe(JSON.stringify(["Alpha", "Beta"]));
});

test("Screenings can mark a saved view as the page default", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");

  await saveNamedView(page, "My screenings");
  await page.getByRole("button", { name: "Set default" }).click();
  await page.reload();

  await expect(page.getByLabel("Screenings saved view")).toHaveValue("My screenings");
  await expect(page.getByRole("button", { name: "Default ✓" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("Movie Day restores a default planning view without changing movie selection", async ({
  page,
}) => {
  await mockApi(page);
  await page.goto("/plan");

  await page.getByLabel("Number of movies").selectOption("1");
  await page.getByLabel("Movie day start").fill("17:00");
  await page.getByLabel("Movie day end").fill("23:00");
  await saveNamedView(page, "After work");
  await page.getByRole("button", { name: "Set default" }).click();

  await page.reload();

  await expect(page.getByLabel("Movie Day saved view")).toHaveValue("After work");
  await expect(page.getByLabel("Number of movies")).toHaveValue("1");
  await expect(page.getByLabel("Movie day start")).toHaveValue("17:00");
  await expect(page.getByLabel("Movie day end")).toHaveValue("23:00");
  await expect(
    page.evaluate(() => localStorage.getItem("movie-showtime-aggregator.selected-movies.v1")),
  ).resolves.toBe(JSON.stringify(["Alpha", "Beta"]));
});
