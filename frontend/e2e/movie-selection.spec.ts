import { expect, type Locator, type Page, test } from "@playwright/test";

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
  count: 4,
  total_count: 4,
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
    {
      showtime_id: "beta-2",
      movie: "Beta",
      theatre: "Harkins Valley 14",
      chain: "Harkins Theatres",
      format: "Standard",
      advertised_start: "2026-09-06T11:00:00",
      actual_start: null,
      estimated_end: null,
      runtime_minutes: 105,
      distance_miles: 8.7,
      purchase_url: "https://example.test/beta-matinee",
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

function facetMenu(page: Page, label: string): Locator {
  return page.getByRole("dialog", { name: `${label} filter` });
}

async function openFacet(page: Page, label: string): Promise<Locator> {
  await page.getByRole("button", { name: `Filter by ${label.toLowerCase()}` }).click();
  return facetMenu(page, label);
}

/** Restrict a checkbox filter to exactly `values`, then close its menu. */
async function keepOnly(page: Page, label: string, values: string[]): Promise<void> {
  const menu = await openFacet(page, label);
  await menu.getByRole("button", { name: "None" }).click();
  for (const value of values) {
    await menu.getByRole("checkbox", { name: value, exact: true }).check();
  }
  await menu.getByRole("button", { name: `Close ${label.toLowerCase()} filter` }).click();
}

async function mockApi(page: Page, extraMovieTitles: string[] = []): Promise<void> {
  const screenings = [
    ...screeningsPayload.screenings,
    ...extraMovieTitles.map((movie, index) => ({
      ...screeningsPayload.screenings[0],
      movie,
      showtime_id: `extra-${index}`,
      movie_source_id: `extra-${index}`,
    })),
  ];
  await page.route("**/api/screenings?*", async (route) => {
    await route.fulfill({
      json: {
        ...screeningsPayload,
        screenings,
        count: screenings.length,
        total_count: screenings.length,
        facets: {
          ...screeningsPayload.facets,
          movies: [...screeningsPayload.facets.movies, ...extraMovieTitles],
        },
      },
    });
  });
}

async function openMovieFilters(page: Page): Promise<void> {
  const toggle = page.getByRole("button", { name: "Show movie filters" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(page.getByRole("button", { name: "Hide movie filters" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
}

test("movie selection supports filtering and release-date sorting", async ({ page }) => {
  await mockApi(page);
  await page.goto("/movies");
  await page.getByText("Sort & saved views", { exact: true }).click();

  await expect(page.getByLabel("Filter titles")).toHaveCount(0);
  await openMovieFilters(page);

  await page.getByLabel("Sort movies").selectOption("initial_release_date");
  await expect(
    page
      .getByRole("button", { name: "Add Alpha to this day" })
      .getByText("Initial release · Aug 15, 2026"),
  ).toBeVisible();
  await expect(
    page
      .getByRole("button", { name: "Add Beta to this day" })
      .getByText("Initial release · Jan 10, 1999"),
  ).toBeVisible();
  await expect(page.locator(".movie-tile").first()).toHaveAttribute(
    "aria-label",
    "Add Alpha to this day",
  );

  await page.getByLabel("Filter titles").fill("Beta");
  await expect(page.getByRole("button", { name: "Add Beta to this day" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Alpha to this day" })).toHaveCount(0);

  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByLabel("Minimum IMDb").fill("8");
  await expect(page.getByRole("button", { name: "Add Alpha to this day" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Beta to this day" })).toHaveCount(0);
});

test("movie selection filters by actual theater and chain availability", async ({ page }) => {
  await mockApi(page);
  await page.goto("/movies");
  await openMovieFilters(page);

  await keepOnly(page, "Theater", ["AMC Center 8"]);
  await expect(page.getByRole("button", { name: "Add Alpha to this day" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Beta to this day" })).toHaveCount(0);

  await page.getByRole("button", { name: "Clear filters" }).click();
  await keepOnly(page, "Chain", ["Harkins Theatres"]);
  await expect(page.getByRole("button", { name: "Add Alpha to this day" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Beta to this day" })).toBeVisible();

  await keepOnly(page, "Theater", ["AMC Center 8"]);
  await expect(page.getByRole("button", { name: "Add Alpha to this day" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add Beta to this day" })).toHaveCount(0);
});

test("movie selection checkbox filters cover format, listed time, and selection", async ({
  page,
}) => {
  await mockApi(page);
  await page.goto("/movies");
  await openMovieFilters(page);

  await keepOnly(page, "Format", ["IMAX"]);
  await expect(page.getByRole("button", { name: "Add Alpha to this day" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Beta to this day" })).toHaveCount(0);

  await page.getByRole("button", { name: "Clear filters" }).click();
  await keepOnly(page, "Listed time", ["Matinee · before 12pm"]);
  await expect(page.getByRole("button", { name: "Add Beta to this day" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Alpha to this day" })).toHaveCount(0);

  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByRole("button", { name: "Add Alpha to this day" }).click();
  await keepOnly(page, "Selection", ["Wanted"]);
  await expect(page.getByRole("button", { name: "Remove Alpha from this day" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Beta to this day" })).toHaveCount(0);

  await keepOnly(page, "Selection", ["Not wanted"]);
  await expect(page.getByRole("button", { name: "Add Beta to this day" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove Alpha from this day" })).toHaveCount(0);

  await expect(page.getByText("1 active filters")).toBeVisible();
});

test("screening saved views do not overwrite the persistent want list", async ({ page }) => {
  await mockApi(page);
  await page.goto("/movies");
  await page.getByRole("button", { name: "Add Alpha to this day" }).click();

  await page.goto("/showtimes");
  page.once("dialog", async (dialog) => dialog.accept("No want-list coupling"));
  await page.getByRole("button", { name: "Save view" }).click();

  await page.goto("/movies");
  await page.getByRole("button", { name: "Add Beta to this day" }).click();

  await page.goto("/showtimes");
  await page.getByRole("combobox").first().selectOption({ label: "No want-list coupling" });
  await page.goto("/movies");

  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem("movie-showtime-aggregator.selected-movies.v1") ?? "[]"),
      ),
    )
    .toEqual(["Alpha", "Beta"]);
});

test("the choose-movies grid enforces 10 candidates, but keeps the want list unlimited", async ({
  page,
}) => {
  const extraMovies = Array.from({ length: 9 }, (_, index) => `Film ${index + 1}`);
  await mockApi(page, extraMovies);
  await page.goto("/movies");

  await page.getByRole("button", { name: "Add Alpha to this day" }).click();
  await page.getByRole("button", { name: "Add Beta to this day" }).click();
  for (const movie of extraMovies.slice(0, 8)) {
    await page.getByRole("button", { name: `Add ${movie} to this day` }).click();
  }

  await expect(page.getByText("10 / 10 for this day")).toBeVisible();
  await expect(page.getByText("10-movie limit reached · remove one to add another")).toBeVisible();
  const eleventh = page.getByRole("button", { name: "Add Film 9 to this day" });
  await expect(eleventh).toBeDisabled();
  await expect(eleventh.getByText("10-movie limit reached")).toBeVisible();

  await page.getByRole("button", { name: "Remove Alpha from this day" }).click();
  await expect(eleventh).toBeEnabled();
  await eleventh.click();
  await expect(page.getByText("10 / 10 for this day")).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove Film 9 from this day" })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem("movie-showtime-aggregator.selected-movies.v1") ?? "[]"),
      ),
    )
    .toHaveLength(11);
});

test("saved movie selections exceeding 10 are capped for the day", async ({ page }) => {
  const extraMovies = Array.from({ length: 9 }, (_, index) => `Film ${index + 1}`);
  await page.addInitScript((titles) => {
    localStorage.setItem("movie-showtime-aggregator.selected-movies.v1", JSON.stringify(titles));
  }, ["Alpha", "Beta", ...extraMovies]);
  await mockApi(page, extraMovies);
  await page.goto("/movies");
  await expect(page.getByText("10 / 10 for this day")).toBeVisible();
  await expect(page.locator(".movie-tile[aria-pressed='true']")).toHaveCount(10);
  await expect(page.locator(".movie-tile[aria-pressed='false']:not(:disabled)")).toHaveCount(0);
});
