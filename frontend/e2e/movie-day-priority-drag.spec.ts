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

const screenings = ["Alpha", "Beta", "Gamma"].map((movie, index) => ({
  ...baseScreening,
  showtime_id: `${movie.toLowerCase()}-1`,
  movie,
  theatre: "AMC Center 8",
  advertised_start: `2026-09-10T${String(8 + index * 3).padStart(2, "0")}:35:00`,
  actual_start: `2026-09-10T${String(9 + index * 3).padStart(2, "0")}:00:00`,
  estimated_end: `2026-09-10T${String(11 + index * 3).padStart(2, "0")}:00:00`,
  runtime_minutes: 120,
  purchase_url: `https://example.test/${movie.toLowerCase()}`,
  theatre_latitude: 33.45,
  theatre_longitude: -112.07,
}));

async function mockScreenings(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem(
      "movie-showtime-aggregator.selected-movies.v1",
      JSON.stringify(["Alpha", "Beta", "Gamma"]),
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
        preview_minutes_by_chain: { AMC: 25 },
        enrichment_enabled: true,
        count: screenings.length,
        total_count: screenings.length,
        facets: {
          chains: ["AMC"],
          movies: ["Alpha", "Beta", "Gamma"],
          theatres: ["AMC Center 8"],
          formats: ["Standard"],
        },
        screenings,
      },
    });
  });
}

function priorityTitles(page: Page) {
  return page.locator(".movie-priority-title strong");
}

test("priority rows use drag handles and can send a movie directly to the top", async ({ page }) => {
  await mockScreenings(page);
  await page.goto("/plan");

  await expect(page.getByRole("button", { name: "Drag Beta to reorder" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Move Beta up; send to top" })).toHaveText("Top");
  await expect(page.locator(".movie-priority-moves")).toHaveCount(0);

  await page.getByRole("button", { name: "Move Gamma up; send to top" }).click();
  await expect(priorityTitles(page)).toHaveText(["Gamma", "Alpha", "Beta"]);
});

test("dragging the three-line handle reorders movie priority", async ({ page }) => {
  await mockScreenings(page);
  await page.goto("/plan");

  const handle = page.getByRole("button", { name: "Drag Beta to reorder" });
  const alphaRow = page.locator("[data-movie-priority-row]").filter({ hasText: "Alpha" });
  const handleBox = await handle.boundingBox();
  const alphaBox = await alphaRow.boundingBox();
  expect(handleBox).not.toBeNull();
  expect(alphaBox).not.toBeNull();
  if (!handleBox || !alphaBox) return;

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + handleBox.width / 2, alphaBox.y + 2, { steps: 6 });
  await page.mouse.up();

  await expect(priorityTitles(page)).toHaveText(["Beta", "Alpha", "Gamma"]);
});
