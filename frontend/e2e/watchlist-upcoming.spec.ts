import { expect, test } from "@playwright/test";

test("Watchlist defaults to confirmed upcoming movies and can opt into all saved titles", async ({
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
    localStorage.setItem("movie-showtime-aggregator.watched-movies.v1", '["Watched Absent"]');
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
  const include = page.getByRole("checkbox", {
    name: "Include movies without upcoming showtimes",
  });
  await expect(include).not.toBeChecked();
  await expect(page.locator(".watchlist-item")).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "Today Only" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Future Only" })).toBeVisible();
  await expect(page.getByText(/1 remaining today · latest/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Past Only" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Not Scheduled" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Watched Absent" })).toHaveCount(0);

  await include.check();
  await expect(page.locator(".watchlist-item")).toHaveCount(5);
  await expect(page.getByRole("heading", { name: "Watched Absent" })).toBeVisible();
  await expect(page.getByText("No upcoming published showtimes")).toHaveCount(3);
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("movie-showtime-aggregator.selected-movies.v1") ?? "[]"),
  );
  expect(saved).toEqual(["Today Only", "Future Only", "Past Only", "Not Scheduled"]);
  await include.uncheck();
  await expect(page.locator(".watchlist-item")).toHaveCount(2);

  // A same-day showing stops qualifying as soon as its listed start passes.
  await page.clock.fastForward(2 * 60 * 60 * 1000);
  await expect(page.locator(".watchlist-item")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Today Only" })).toHaveCount(0);
});

test("failed schedule scans never present unverified movies as upcoming", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("movie-showtime-aggregator.selected-movies.v1", '["Unknown"]');
    localStorage.setItem("movie-showtime-aggregator.want-list-migration.v1", "1");
  });
  await page.route("**/api/movie-availability?*", (route) =>
    route.fulfill({ status: 503, json: { error: "Unavailable" } }),
  );
  await page.route("**/api/screenings?*", (route) => route.fulfill({ json: { screenings: [] } }));
  await page.goto("/watchlist");
  await expect(
    page.getByText(/Some schedules could not be checked; showing only confirmed/),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Unknown" })).toHaveCount(0);
  await page.getByRole("checkbox", {
    name: "Include movies without upcoming showtimes",
  }).check();
  await expect(page.getByRole("heading", { name: "Unknown" })).toBeVisible();
});

test("partially unavailable future dates preserve confirmed titles only", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "movie-showtime-aggregator.selected-movies.v1",
      '["Has Later","Unverified"]',
    );
    localStorage.setItem("movie-showtime-aggregator.want-list-migration.v1", "1");
  });
  await page.route("**/api/movie-availability?*", (route) =>
    route.fulfill({
      json: {
        after_date: "2026-10-29",
        window_end: "2026-11-12",
        checked_dates: ["2026-10-30"],
        unavailable_dates: ["2026-11-01"],
        movies: {
          "Has Later": {
            scheduled_days: 1,
            showtime_count: 1,
            last_scheduled_date: "2026-10-30",
          },
        },
      },
    }),
  );
  await page.route("**/api/screenings?*", (route) => route.fulfill({ json: { screenings: [] } }));
  await page.goto("/watchlist");
  await expect(page.getByRole("heading", { name: "Has Later" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Unverified" })).toHaveCount(0);
  await expect(page.getByText(/Some future dates could not be checked/)).toBeVisible();
});
