import { expect, type Page, test } from "@playwright/test";

function today(): string {
  const value = new Date();
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function screening(date: string, movie: string, hour: number) {
  const slug = movie.toLowerCase();
  return {
    showtime_id: `${date}-${slug}`,
    movie,
    theatre: "AMC Center 8",
    chain: "AMC",
    format: "Standard",
    advertised_start: `${date}T${String(hour).padStart(2, "0")}:35:00`,
    actual_start: `${date}T${String(hour + 1).padStart(2, "0")}:00:00`,
    estimated_end: `${date}T${String(hour + 2).padStart(2, "0")}:00:00`,
    runtime_minutes: 60,
    distance_miles: 4,
    purchase_url: `https://example.test/${slug}`,
    movie_source_id: slug,
    theatre_latitude: 33.45,
    theatre_longitude: -112.07,
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
}

async function mockScreenings(page: Page, date: string): Promise<void> {
  const screenings = [screening(date, "Alpha", 8), screening(date, "Beta", 11)];
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
          theatres: ["AMC Center 8"],
          formats: ["Standard"],
        },
        screenings,
      },
    });
  });
}

function planResponse(date: string, targetCount: number) {
  const alpha = {
    showtime_ids: [`${date}-alpha`],
    movies: ["Alpha"],
    dropped_movies: ["Beta"],
    want_score: 2,
    starts_at: `${date}T09:00:00`,
    ends_at: `${date}T10:00:00`,
    home_at: `${date}T10:10:00`,
    elapsed_minutes: 80,
    movie_minutes: 60,
    travel_minutes: 20,
    waiting_minutes: 0,
    legs: [],
  };
  const beta = {
    showtime_ids: [`${date}-beta`],
    movies: ["Beta"],
    dropped_movies: ["Alpha"],
    want_score: 1,
    starts_at: `${date}T12:00:00`,
    ends_at: `${date}T13:00:00`,
    home_at: `${date}T13:10:00`,
    elapsed_minutes: 80,
    movie_minutes: 60,
    travel_minutes: 20,
    waiting_minutes: 0,
    legs: [],
  };
  const both = {
    showtime_ids: [`${date}-alpha`, `${date}-beta`],
    movies: ["Alpha", "Beta"],
    dropped_movies: [],
    want_score: 3,
    starts_at: `${date}T09:00:00`,
    ends_at: `${date}T13:00:00`,
    home_at: `${date}T13:10:00`,
    elapsed_minutes: 260,
    movie_minutes: 120,
    travel_minutes: 20,
    waiting_minutes: 120,
    legs: [
      {
        from_showtime_id: `${date}-alpha`,
        to_showtime_id: `${date}-beta`,
        from_theatre: "AMC Center 8",
        to_theatre: "AMC Center 8",
        drive_minutes: 0,
        gap_minutes: 120,
        route_source_url: "",
      },
    ],
  };
  const itineraries = targetCount === 1 ? [alpha, beta] : [both];
  return {
    date,
    selected_movies: ["Alpha", "Beta"],
    required_movies: [],
    runtime_overrides: {},
    target_movie_count: targetCount,
    plannable_movie_count: 2,
    sort_by: "want",
    secondary_sort_by: "elapsed",
    earliest_start: null,
    latest_end: null,
    eligible_showings: 2,
    unplannable_showings: 0,
    missing_movies: [],
    missing_required_movies: [],
    total_itineraries: itineraries.length,
    offset: 0,
    limit: 25,
    has_more: false,
    minimum_buffer_minutes: 0,
    routing_available: true,
    itineraries,
  };
}

test("Any returns itineraries across every feasible movie count in global want-score order", async ({
  page,
}) => {
  const date = today();
  await mockScreenings(page, date);
  const requestedCounts: number[] = [];
  await page.route("**/api/movie-day", async (route) => {
    const request = route.request().postDataJSON() as { target_movie_count: number };
    requestedCounts.push(request.target_movie_count);
    await route.fulfill({ json: planResponse(date, request.target_movie_count) });
  });

  await page.goto("/plan");
  await page.getByLabel("Number of movies").selectOption("any");
  await page.getByRole("button", { name: "Find itineraries" }).click();

  await expect(
    page.getByText("3 feasible itineraries across all valid movie counts"),
  ).toBeVisible();
  expect(requestedCounts.sort()).toEqual([1, 2]);
  const cards = page.locator(".itinerary-card");
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0).getByText("Alpha", { exact: true })).toBeVisible();
  await expect(cards.nth(0).getByText("Beta", { exact: true })).toBeVisible();
});

test("the priority-list X removes a movie from this day but keeps it wanted", async ({
  page,
}) => {
  const date = today();
  await mockScreenings(page, date);
  await page.goto("/plan");

  await page.getByRole("button", { name: "Remove Alpha from this day" }).click();

  await expect(page.getByRole("button", { name: "Remove Alpha from this day" })).toHaveCount(0);
  const selected = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("movie-showtime-aggregator.selected-movies.v1") ?? "[]"),
  );
  expect(selected).toEqual(["Alpha", "Beta"]);
});
