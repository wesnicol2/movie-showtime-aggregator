import { expect, type Page, test } from "@playwright/test";

const baseline = {
  runtime_minutes: 120,
  actual_start: null,
  estimated_end: null,
  movie_source_id: "",
  theatre_latitude: null,
  theatre_longitude: null,
  drive_to_minutes: null,
  drive_home_minutes: null,
  leave_home: null,
  home_arrival: null,
  poster_url: "",
  imdb_rating: 8.1,
  metacritic_score: 80,
  rotten_tomatoes_score: 90,
  initial_release_date: "2026-10-01",
  seats_left_percent: null,
  amc_a_list_eligible: null,
  amc_source_url: "",
  letterboxd_url: "",
  imdb_url: "",
  rotten_tomatoes_url: "",
  metacritic_url: "",
  route_source_url: "",
};
function screening(
  id: string,
  movie: string,
  imdb: string,
  chain: string,
  theatre: string,
  start: string,
  format: string,
  price: number,
  distance: number,
) {
  return {
    ...baseline,
    showtime_id: id,
    movie,
    imdb_id: imdb,
    chain,
    theatre,
    advertised_start: start,
    format,
    ticket_price: price,
    distance_miles: distance,
    purchase_url: "https://example.test/" + id,
  };
}
const rows = [
  screening(
    "a1",
    "Alpha",
    "tt1111111",
    "AMC",
    "AMC Midtown",
    "2026-10-12T10:00:00",
    "Standard",
    12,
    4,
  ),
  screening("a2", "Alpha", "tt1111111", "AMC", "AMC Midtown", "2026-10-12T12:00:00", "IMAX", 14, 4),
  screening("a3", "Alpha", "tt1111111", "AMC", "AMC West", "2026-10-12T18:00:00", "IMAX", 18, 6),
  screening(
    "a4",
    "Alpha",
    "tt1111111",
    "Harkins",
    "Harkins North",
    "2026-10-12T20:00:00",
    "Standard",
    11,
    5,
  ),
  screening(
    "b1",
    "Beta",
    "tt2222222",
    "Harkins",
    "Harkins North",
    "2026-10-12T19:00:00",
    "Standard",
    10,
    5,
  ),
];

async function mockFuture(page: Page) {
  await page.route("**/api/movie-availability?*", async (route) => {
    await route.fulfill({
      json: {
        after_date: "2026-10-12",
        window_end: "2026-10-26",
        checked_dates: ["2026-10-13", "2026-10-14", "2026-10-16"],
        unavailable_dates: [],
        movies: {},
        future_screenings: [
          screening("a5", "Alpha", "tt1111111", "AMC", "AMC Midtown", "2026-10-14T17:30:00", "IMAX", 0, 4),
          screening("a6", "Alpha", "tt1111111", "Harkins", "Harkins North", "2026-10-16T19:30:00", "Standard", 0, 5),
          screening("b2", "Beta", "tt2222222", "Harkins", "Harkins North", "2026-10-13T19:00:00", "Standard", 0, 5),
        ],
      },
    });
  });
}

async function mockScreenings(page: Page) {
  await mockFuture(page);
  await page.route("**/api/screenings?*", async (route) => {
    await route.fulfill({
      json: {
        date: "2026-10-12",
        market_zip: "85004",
        radius_miles: 15,
        location: { zip_code: "85004", radius_miles: 15 },
        preferences: { amc_vendor_key_set: false, omdb_api_key_set: true, amc_a_list: false },
        preview_minutes_by_chain: {},
        enrichment_enabled: true,
        count: rows.length,
        total_count: rows.length,
        facets: {
          chains: ["AMC", "Harkins"],
          movies: ["Alpha", "Beta"],
          theatres: ["AMC Midtown", "AMC West", "Harkins North"],
          formats: ["Standard", "IMAX"],
        },
        screenings: rows.map((row) =>
          row.showtime_id === "a1"
            ? { ...row, amc_source_url: "https://www.amctheatres.com/showtimes/144169522/tickets" }
            : row,
        ),
      },
    });
  });
}

test("one card per movie, distinct theaters by chain, expand showtimes, and share table filters", async ({
  page,
}) => {
  await mockScreenings(page);
  await page.goto("/showtimes");
  await expect(page.getByRole("heading", { name: "Now playing" })).toBeVisible();
  await expect(page.getByTestId("showcase-movie")).toHaveCount(2);
  const alpha = page
    .getByTestId("showcase-movie")
    .filter({ has: page.getByRole("heading", { name: "Alpha" }) });
  await expect(alpha.getByText("AMC 2 theaters")).toBeVisible();
  await expect(alpha.getByText("Harkins 1 theater")).toBeVisible();
  await expect(alpha.getByText("4 showtimes")).toBeVisible();
  await expect(alpha.getByTestId("last-listed")).toContainText("Fri, Oct 16 · 7:30 PM · Harkins North (Harkins)");
  await expect(page.getByText("Latest published listings through Oct 26")).toBeVisible();
  await alpha.getByText("View theaters and showtimes").click();
  await expect(alpha.getByText("AMC Midtown", { exact: true })).toBeVisible();
  await expect(alpha.getByText("12:00 PM · IMAX · $14.00")).toBeVisible();
  await expect(alpha.getByRole("link", { name: "10:00 AM · Standard · $12.00 ↗" })).toHaveAttribute(
    "href",
    "https://www.amctheatres.com/showtimes/144169522/tickets",
  );
  await expect(alpha.getByRole("link", { name: "12:00 PM · IMAX · $14.00 ↗" })).toHaveAttribute(
    "href",
    "https://example.test/a2",
  );

  await page.getByRole("button", { name: "Toggle screening filters" }).click();
  await page.getByRole("button", { name: "Filter Chain" }).click();
  const filter = page.getByRole("dialog", { name: "Chain filter" });
  await filter.getByRole("button", { name: "None" }).click();
  await expect(page.getByTestId("showcase-movie")).toHaveCount(0);
  await filter.getByRole("checkbox", { name: "AMC" }).check();
  await expect(page.getByTestId("showcase-movie")).toHaveCount(1);
  await expect(alpha.getByText("AMC 2 theaters")).toBeVisible();
  await expect(alpha.getByText("3 showtimes")).toBeVisible();
  await expect(alpha.getByTestId("last-listed")).toContainText("Wed, Oct 14 · 5:30 PM · AMC Midtown (AMC)");
  await expect(alpha.getByTestId("last-listed")).toContainText("Later at another theater/chain:");
  await expect(alpha.getByTestId("last-listed")).toContainText("Fri, Oct 16 · 7:30 PM · Harkins North (Harkins)");
  await expect(alpha.getByText("Harkins 1 theater")).toHaveCount(0);

  await filter.getByRole("button", { name: "Close filter" }).click();
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await expect(page.getByTestId("screening-table-wrap")).toBeVisible();
  await expect(page.locator(".screening-table tbody tr")).toHaveCount(3);
});

test("different IMDb identities with the same title remain separate", async ({ page }) => {
  await page.route("**/api/movie-availability?*", async (route) => {
    await route.fulfill({
      json: {
        after_date: "2026-10-12", window_end: "2026-10-26",
        checked_dates: ["2026-10-14"], unavailable_dates: [], movies: {},
        future_screenings: [screening("later", "The Return", "tt1111111", "AMC", "AMC Midtown", "2026-10-14T18:00:00", "Standard", 0, 4)],
      },
    });
  });
  await page.route("**/api/screenings?*", async (route) => {
    await route.fulfill({
      json: {
        date: "2026-10-12",
        location: { zip_code: "85004", radius_miles: 15 },
        preferences: { amc_vendor_key_set: false, omdb_api_key_set: false, amc_a_list: false },
        screenings: [
          screening(
            "one",
            "The Return",
            "tt1111111",
            "AMC",
            "AMC Midtown",
            "2026-10-12T10:00:00",
            "Standard",
            12,
            4,
          ),
          screening(
            "two",
            "The Return",
            "tt2222222",
            "AMC",
            "AMC West",
            "2026-10-12T12:00:00",
            "Standard",
            12,
            5,
          ),
        ],
      },
    });
  });
  await page.goto("/showtimes");
  await expect(page.getByTestId("showcase-movie")).toHaveCount(2);
  const cards = page.getByTestId("showcase-movie");
  await expect(cards.nth(0).getByTestId("last-listed")).toContainText("Oct 14");
  await expect(cards.nth(1).getByTestId("last-listed")).not.toContainText("Oct 14");
});
