import { expect, test } from "@playwright/test";

const screeningsPayload = {
  date: "2026-09-06",
  market_zip: "85004",
  radius_miles: 15,
  location: { zip_code: "85004", radius_miles: 15 },
  preferences: {
    amc_vendor_key_set: false,
    omdb_api_key_set: false,
    amc_a_list: false,
    home_configured: false,
  },
  preview_minutes_by_chain: {},
  enrichment_enabled: false,
  count: 1,
  total_count: 1,
  facets: {
    chains: ["Independent"],
    movies: ["Alpha"],
    theatres: ["Cinema One"],
    formats: ["Standard"],
  },
  screenings: [
    {
      showtime_id: "alpha-1",
      movie: "Alpha",
      theatre: "Cinema One",
      chain: "Independent",
      format: "Standard",
      advertised_start: "2026-09-06T18:00:00",
      actual_start: null,
      estimated_end: null,
      runtime_minutes: 120,
      distance_miles: 4.2,
      purchase_url: "",
      imdb_rating: 8.1,
      rotten_tomatoes_score: 91,
      metacritic_score: 77,
      seats_left_percent: null,
      ticket_price: null,
      leave_home: null,
      home_arrival: null,
    },
  ],
};

test("column filters stay usable after selecting None", async ({ page }) => {
  await page.route("**/api/screenings?*", async (route) => {
    await route.fulfill({ json: screeningsPayload });
  });

  await page.goto("/");
  await expect(page.getByText("1 of 1 screenings")).toBeVisible();

  await page.getByRole("button", { name: "Filter RT" }).click();
  const rtFilter = page.getByRole("dialog", { name: "RT filter" });
  await rtFilter.getByRole("button", { name: "None" }).click();
  await expect(page.getByText("0 of 1 screenings")).toBeVisible();

  await rtFilter.getByRole("button", { name: "All" }).click();
  await expect(page.getByText("1 of 1 screenings")).toBeVisible();

  await rtFilter.getByRole("button", { name: "None" }).click();
  await page.getByRole("button", { name: "Filter Theater" }).click();
  const theaterFilter = page.getByRole("dialog", { name: "Theater filter" });
  await expect(theaterFilter.getByText("Cinema One", { exact: true })).toBeVisible();
  await theaterFilter.getByRole("button", { name: "All" }).click();
});
