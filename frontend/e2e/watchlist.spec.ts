import { expect, test } from "@playwright/test";

test("watchlist preserves wanted and watched titles and displays published availability", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("movie-showtime-aggregator.selected-movies.v1", '["Alpha"]');
    localStorage.setItem("movie-showtime-aggregator.watched-movies.v1", '["Seen"]');
    localStorage.setItem("movie-showtime-aggregator.want-list-migration.v1", "1");
  });
  await page.route("**/api/movie-availability?*", async (route) => {
    await route.fulfill({
      json: {
        after_date: "2026-10-11",
        window_end: "2026-10-25",
        checked_dates: ["2026-10-12"],
        unavailable_dates: [],
        movies: {
          Alpha: {
            scheduled_days: 2,
            showtime_count: 7,
            last_scheduled_date: "2026-10-15",
          },
        },
      },
    });
  });

  await page.route("**/api/screenings?*", (route) =>
    route.fulfill({ json: { screenings: [] } }),
  );

  await page.goto("/watchlist");
  await expect(page.getByRole("heading", { name: "Watchlist" })).toBeVisible();
  await expect(page.getByText("2 listed days · 7 showtimes")).toBeVisible();
  await expect(page.getByText("Seen", { exact: true })).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Include movies without upcoming showtimes" }).check();
  await expect(page.getByText("Seen", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Mark watched" }).click();
  const wanted = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("movie-showtime-aggregator.selected-movies.v1") ?? "[]"),
  );
  const watched = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("movie-showtime-aggregator.watched-movies.v1") ?? "[]"),
  );
  expect(wanted).toEqual([]);
  expect(watched).toEqual(["Alpha", "Seen"]);
});
