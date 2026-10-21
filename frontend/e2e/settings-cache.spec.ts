import { expect, test } from "@playwright/test";

test("Settings force refresh tracks background progress and completes", async ({ page }) => {
  let started = false;
  let polls = 0;

  await page.route("**/api/settings", async (route) => {
    await route.fulfill({
      json: {
        home_address: "",
        home_display_name: "",
        amc_vendor_key_set: false,
        omdb_api_key_set: false,
        amc_a_list: false,
        provider_usage: {},
        experience_deviations: [],
      },
    });
  });
  await page.route("**/api/screenings?*", async (route) => {
    await route.fulfill({
      json: {
        date: "2026-10-21",
        market_zip: "85004",
        radius_miles: 25,
        location: { zip_code: "85004", radius_miles: 25 },
        preferences: {},
        preview_minutes_by_chain: {},
        enrichment_enabled: false,
        count: 0,
        total_count: 0,
        facets: { chains: [], movies: [], theatres: [], formats: [] },
        screenings: [],
      },
    });
  });
  await page.route("**/api/cache/status", async (route) => {
    polls += 1;
    const running = started && polls < 3;
    await route.fulfill({
      json: {
        day: "2026-10-21",
        base_dates: running ? 7 : started ? 15 : 0,
        responses: 2,
        updated_at: "2026-10-21T00:00:00-07:00",
        running,
        completed: running ? 7 : started ? 15 : 0,
        total: 15,
        started_at: started ? "2026-10-21T00:00:00-07:00" : null,
        finished_at: running ? null : "2026-10-21T00:01:00-07:00",
        errors: [],
      },
    });
  });
  await page.route("**/api/cache/refresh", async (route) => {
    expect(route.request().method()).toBe("POST");
    started = true;
    polls = 0;
    await route.fulfill({
      json: {
        day: "2026-10-21",
        base_dates: 0,
        responses: 0,
        updated_at: null,
        running: true,
        completed: 0,
        total: 15,
        started_at: "2026-10-21T00:00:00-07:00",
        finished_at: null,
        errors: [],
      },
    });
  });

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Daily showtime cache" })).toBeVisible();
  await page.getByRole("button", { name: "Force refresh" }).click();
  await expect(page.getByRole("button", { name: "Refreshing…" })).toBeDisabled();
  await expect(page.getByText("Cache refresh completed")).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("button", { name: "Force refresh" })).toBeEnabled();
});
