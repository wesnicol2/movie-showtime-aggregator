import { expect, type Page, test } from "@playwright/test";

function isoDate(): string {
  const value = new Date();
  value.setHours(12, 0, 0, 0);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function seedSavedPlan(page: Page): Promise<string> {
  const date = isoDate();
  await page.addInitScript(
    ({ planDate }) => {
      const alpha = {
        showtime_id: `${planDate}-alpha`,
        movie: "Alpha",
        theatre: "AMC Center 8",
        chain: "AMC",
        format: "Standard",
        advertised_start: `${planDate}T08:35:00`,
        actual_start: `${planDate}T09:00:00`,
        estimated_end: `${planDate}T11:00:00`,
        runtime_minutes: 120,
        distance_miles: 4,
        purchase_url: "https://example.test/alpha",
        movie_source_id: "alpha",
        theatre_latitude: 33.45,
        theatre_longitude: -112.07,
        drive_to_minutes: 8,
        drive_home_minutes: 8,
        leave_home: `${planDate}T08:52:00`,
        home_arrival: null,
        poster_url: "",
        imdb_id: "",
        imdb_rating: null,
        metacritic_score: null,
        rotten_tomatoes_score: null,
        initial_release_date: null,
        ticket_price: 14.99,
        seats_left_percent: null,
        amc_a_list_eligible: true,
        amc_source_url: "https://example.test/amc-alpha",
        letterboxd_url: "",
        imdb_url: "",
        rotten_tomatoes_url: "",
        metacritic_url: "",
        route_source_url: "",
      };
      const beta = {
        ...alpha,
        showtime_id: `${planDate}-beta`,
        movie: "Beta",
        theatre: "AMC Valley 12",
        advertised_start: `${planDate}T11:35:00`,
        actual_start: `${planDate}T12:00:00`,
        estimated_end: `${planDate}T13:40:00`,
        runtime_minutes: 100,
        distance_miles: 7,
        purchase_url: "https://example.test/beta",
        movie_source_id: "beta",
        drive_to_minutes: 12,
        drive_home_minutes: 12,
        leave_home: null,
        home_arrival: `${planDate}T13:52:00`,
        ticket_price: 0,
        amc_source_url: "https://example.test/amc-beta",
      };

      localStorage.setItem(
        "movie-showtime-aggregator.selected-movies.v1",
        JSON.stringify(["Alpha", "Beta"]),
      );
      localStorage.setItem(
        "movie-showtime-aggregator.planner.v1",
        JSON.stringify({
          [planDate]: {
            date: planDate,
            savedAt: `${planDate}T07:00:00`,
            itinerary: {
              showtime_ids: [alpha.showtime_id, beta.showtime_id],
              movies: ["Alpha", "Beta"],
              dropped_movies: [],
              want_score: 3,
              starts_at: `${planDate}T09:00:00`,
              ends_at: `${planDate}T13:40:00`,
              home_at: `${planDate}T13:52:00`,
              elapsed_minutes: 300,
              movie_minutes: 220,
              travel_minutes: 32,
              waiting_minutes: 48,
              legs: [
                {
                  from_showtime_id: alpha.showtime_id,
                  to_showtime_id: beta.showtime_id,
                  from_theatre: alpha.theatre,
                  to_theatre: beta.theatre,
                  drive_minutes: 12,
                  gap_minutes: 60,
                  route_source_url: "https://example.test/route",
                },
              ],
            },
            screenings: [alpha, beta],
            runtimeOverrides: {},
          },
        }),
      );
    },
    { planDate: date },
  );

  await page.route("**/api/screenings?*", async (route) => {
    await route.fulfill({
      json: {
        date,
        market_zip: "85004",
        radius_miles: 25,
        location: { zip_code: "85004", radius_miles: 25 },
        preferences: {
          amc_vendor_key_set: true,
          omdb_api_key_set: false,
          amc_a_list: true,
          home_configured: true,
        },
        preview_minutes_by_chain: { AMC: 25 },
        enrichment_enabled: false,
        count: 2,
        total_count: 2,
        facets: { chains: ["AMC"], movies: ["Alpha", "Beta"], theatres: [], formats: [] },
        screenings: [{ showtime_id: `${date}-alpha` }, { showtime_id: `${date}-beta` }],
      },
    });
  });
  return date;
}

test("saved calendar plans show time allocation, AMC prices, and proportional transfer gaps", async ({
  page,
}) => {
  const date = await seedSavedPlan(page);
  await page.goto("/");

  const day = page.locator(`[data-date="${date}"]`);
  const metrics = day.locator(".planner-plan-metrics");
  await expect(metrics.getByText("3h 40m movies")).toBeVisible();
  await expect(metrics.getByText("48m free")).toBeVisible();
  await expect(metrics.getByText("32m driving")).toBeVisible();
  await expect(metrics.getByText("5h total")).toBeVisible();
  await expect(metrics.getByText("$14.99 tickets")).toBeVisible();
  await expect(day.getByText("$14.99", { exact: true })).toBeVisible();
  await expect(day.getByText("A-List $0", { exact: true })).toBeVisible();
  await expect(day.locator(".planner-gap")).toHaveAttribute(
    "aria-label",
    "12 minutes driving, 48 minutes free",
  );

  const driveHeight = await day
    .locator(".planner-gap-segment.drive")
    .evaluate((node) => node.getBoundingClientRect().height);
  const freeHeight = await day
    .locator(".planner-gap-segment.free")
    .evaluate((node) => node.getBoundingClientRect().height);
  expect(freeHeight).toBeGreaterThan(driveHeight);

  await page.evaluate(
    ({ planDate }) => {
      const key = "movie-showtime-aggregator.planner.v1";
      const plans = JSON.parse(localStorage.getItem(key) ?? "{}");
      plans[planDate].screenings[1].ticket_price = null;
      localStorage.setItem(key, JSON.stringify(plans));
      window.dispatchEvent(new Event("movie-showtime-aggregator:planner-updated"));
    },
    { planDate: date },
  );

  await expect(day.getByText("Price unknown", { exact: true })).toBeVisible();
  await expect(metrics.getByText("$14.99 tickets", { exact: true })).toHaveCount(0);
});
