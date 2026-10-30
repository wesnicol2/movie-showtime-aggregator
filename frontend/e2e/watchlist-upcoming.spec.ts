import { expect, test } from "@playwright/test";

test("upcoming-only watchlist filter uses remaining today and later published dates without deleting saved titles", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-10-29T12:00:00Z") });
  const times = await page.evaluate(() => {
    function localIso(date: Date) {
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
    }
    return {
      past: localIso(new Date(Date.now() - 60 * 60 * 1000)),
      future: localIso(new Date(Date.now() + 60 * 60 * 1000)),
    };
  });
  await page.addInitScript(() => {
    localStorage.setItem(
      "movie-showtime-aggregator.selected-movies.v1",
      '["Today Only","Future Only","Past Only","Not Scheduled"]',
    );
    localStorage.setItem("movie-showtime-aggregator.want-list-migration.v1", "1");
  });
  await page.route("**/api/movie-availability?*", async (route) => {
    await route.fulfill({
      json: {
        after_date: "2026-10-29",
        window_end: "2026-11-12",
        checked_dates: ["2026-10-30"],
        unavailable_dates: [],
        movies: {
          "Future Only": {
            scheduled_days: 1,
            showtime_count: 2,
            last_scheduled_date: "2026-10-30",
          },
        },
      },
    });
  });
  await page.route("**/api/screenings?*", async (route) => {
    await route.fulfill({
      json: {
        date: "2026-10-29",
        screenings: [
          { movie: "Today Only", advertised_start: times.future },
          { movie: "Past Only", advertised_start: times.past },
        ],
      },
    });
  });

  await page.goto("/watchlist");
  await expect(page.locator(".watchlist-item")).toHaveCount(4);
  await page.getByRole("checkbox", { name: "Only movies with upcoming showtimes" }).check();
  await expect(page.locator(".watchlist-item")).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "Today Only" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Future Only" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Past Only" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Not Scheduled" })).toHaveCount(0);
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("movie-showtime-aggregator.selected-movies.v1") ?? "[]"),
  );
  expect(saved).toEqual(["Today Only", "Future Only", "Past Only", "Not Scheduled"]);
  await page.getByRole("checkbox", { name: "Only movies with upcoming showtimes" }).uncheck();
  await expect(page.locator(".watchlist-item")).toHaveCount(4);
});

test("an unavailable future scan does not hide watchlist titles", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("movie-showtime-aggregator.selected-movies.v1", '["Unknown"]');
    localStorage.setItem("movie-showtime-aggregator.want-list-migration.v1", "1");
  });
  await page.route("**/api/movie-availability?*", (route) =>
    route.fulfill({ status: 503, json: { error: "Unavailable" } }),
  );
  await page.route("**/api/screenings?*", (route) => route.fulfill({ json: { screenings: [] } }));
  await page.goto("/watchlist");
  await page.getByRole("checkbox", { name: "Only movies with upcoming showtimes" }).check();
  await expect(
    page.getByText("Could not verify upcoming schedules; no titles have been hidden."),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Unknown" })).toBeVisible();
});
