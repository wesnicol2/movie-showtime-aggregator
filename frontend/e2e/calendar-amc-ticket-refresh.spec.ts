import { expect, type Page, test } from "@playwright/test";

const AMC_URL = "https://www.amctheatres.com/showtimes/all/2026-10-17/desertridge/all/147905140";
const FANDANGO_URL = "https://tickets.fandango.com/transaction/ticketing/mobile/jump.aspx?id=1";

function futureDate(): string {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + 2);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

async function setup(
  page: Page,
  options: {
    savedAmcUrl?: string;
    liveMovie?: string;
    unavailable?: boolean;
  } = {},
): Promise<{ date: string; requests: string[] }> {
  const date = futureDate();
  await page.addInitScript(
    ({ planDate, savedAmcUrl }) => {
      const screening = {
        showtime_id: `${planDate}-alpha`,
        movie: "Whalefall (2026)",
        theatre: "AMC Desert Ridge 18",
        chain: "AMC",
        advertised_start: `${planDate}T11:15:00`,
        actual_start: `${planDate}T11:37:00`,
        estimated_end: `${planDate}T13:37:00`,
        runtime_minutes: 120,
        purchase_url: "https://tickets.fandango.com/transaction/ticketing/mobile/jump.aspx?id=1",
        amc_source_url: savedAmcUrl,
        ticket_price: 14.5,
        amc_a_list_eligible: false,
        leave_home: null,
        home_arrival: null,
      };
      localStorage.setItem(
        "movie-showtime-aggregator.planner.v1",
        JSON.stringify({
          [planDate]: {
            date: planDate,
            savedAt: `${planDate}T08:00:00`,
            itinerary: {
              showtime_ids: [screening.showtime_id],
              movies: [screening.movie],
              dropped_movies: [],
              starts_at: screening.actual_start,
              ends_at: screening.estimated_end,
              movie_minutes: 120,
              travel_minutes: 0,
              waiting_minutes: 0,
              elapsed_minutes: 120,
              want_score: 1,
              legs: [],
            },
            screenings: [screening],
            runtimeOverrides: {},
          },
        }),
      );
    },
    { planDate: date, savedAmcUrl: options.savedAmcUrl ?? "" },
  );

  const requests: string[] = [];
  await page.route("**/api/screenings?*", async (route) => {
    requests.push(new URL(route.request().url()).search);
    if (options.unavailable) {
      await route.fulfill({ status: 503, json: { error: "temporarily unavailable" } });
      return;
    }
    await route.fulfill({
      json: {
        screenings: [
          {
            showtime_id: `${date}-alpha`,
            movie: options.liveMovie ?? "Whalefall (2026)",
            theatre: "AMC Desert Ridge 18",
            chain: "AMC",
            advertised_start: `${date}T11:15:00`,
            purchase_url: FANDANGO_URL,
            amc_source_url: AMC_URL,
          },
        ],
      },
    });
  });
  return { date, requests };
}

test("legacy saved AMC links refresh without mutating the itinerary snapshot", async ({ page }) => {
  const { date, requests } = await setup(page);
  await page.goto("/");
  const day = page.locator(`[data-date="${date}"]`);
  await expect(day.getByText("Showtimes still available")).toBeVisible();
  await expect(day.getByRole("link", { name: "Tickets" })).toHaveAttribute("href", AMC_URL);
  await expect(
    day.locator(".planner-ticket-block").getByText("$14.50", { exact: true }),
  ).toBeVisible();
  expect(requests).toEqual([`?date=${date}`]);

  const original = await page.evaluate((planDate) => {
    const raw = localStorage.getItem("movie-showtime-aggregator.planner.v1") ?? "{}";
    return JSON.parse(raw)[planDate].screenings[0].amc_source_url;
  }, date);
  expect(original).toBe("");

  await page.reload();
  await expect(day.getByRole("link", { name: "Tickets" })).toHaveAttribute("href", AMC_URL);
});

test("complete saved AMC links use inexpensive showtime verification", async ({ page }) => {
  const { date, requests } = await setup(page, { savedAmcUrl: AMC_URL });
  await page.goto("/");
  const day = page.locator(`[data-date="${date}"]`);
  await expect(day.getByText("Showtimes still available")).toBeVisible();
  await expect(day.getByRole("link", { name: "Tickets" })).toHaveAttribute("href", AMC_URL);
  expect(requests).toEqual([`?date=${date}&enrich=0`]);
});

test("a mismatched live performance cannot replace the saved ticket destination", async ({
  page,
}) => {
  const { date } = await setup(page, { liveMovie: "Different Film" });
  await page.goto("/");
  const day = page.locator(`[data-date="${date}"]`);
  await expect(day.getByText("Showtimes still available")).toBeVisible();
  await expect(day.getByRole("link", { name: "Tickets" })).toHaveAttribute("href", FANDANGO_URL);
});

test("failed enrichment retains Fandango without losing the saved itinerary", async ({ page }) => {
  const { date } = await setup(page, { unavailable: true });
  await page.goto("/");
  const day = page.locator(`[data-date="${date}"]`);
  await expect(day.getByText("Could not verify showtimes")).toBeVisible();
  await expect(day.getByText("Whalefall (2026)")).toBeVisible();
  await expect(day.getByRole("link", { name: "Tickets" })).toHaveAttribute("href", FANDANGO_URL);
});
