import { expect, test } from "@playwright/test";

test("Movie Selection restores its day from session cache after reload", async ({ page }) => {
  let hits = 0;
  await page.route("**/api/screenings?*", async (route) => {
    hits++;
    const date = new URL(route.request().url()).searchParams.get("date") ?? "";
    await route.fulfill({
      json: {
        date,
        market_zip: "85004",
        radius_miles: 25,
        location: { zip_code: "85004", radius_miles: 25 },
        preferences: { omdb_api_key_set: true },
        preview_minutes_by_chain: {},
        enrichment_enabled: true,
        count: 1,
        total_count: 1,
        facets: {
          chains: ["AMC"],
          movies: ["Alpha"],
          theatres: ["AMC Center"],
          formats: ["Standard"],
        },
        screenings: [
          {
            showtime_id: "alpha-1",
            movie: "Alpha",
            theatre: "AMC Center",
            chain: "AMC",
            format: "Standard",
            advertised_start: `${date}T18:00:00`,
            actual_start: `${date}T18:10:00`,
            estimated_end: `${date}T20:10:00`,
            runtime_minutes: 120,
            distance_miles: 2,
            purchase_url: "",
            poster_url: `/api/posters/${"a".repeat(64)}`,
          },
        ],
      },
    });
  });
  await page.route("**/api/posters/*", (route) =>
    route.fulfill({
      contentType: "image/jpeg",
      body: Buffer.from([255, 216, 255, 217]),
    }),
  );

  await page.goto("/movies");
  await expect(page.getByRole("img", { name: "Alpha poster" })).toBeVisible();
  expect(hits).toBe(1);
  await page.reload();
  await expect(page.getByRole("img", { name: "Alpha poster" })).toBeVisible();
  expect(hits).toBe(1);
  await expect(page.getByText("Loading movie listings…")).toHaveCount(0);

  // Stale browser snapshot renders immediately, then refreshes silently.
  await page.evaluate(() => {
    for (let index = 0; index < sessionStorage.length; index++) {
      const key = sessionStorage.key(index);
      if (!key?.startsWith("movie-showtime-aggregator.screenings.v2.")) continue;
      const entry = JSON.parse(sessionStorage.getItem(key) ?? "{}");
      entry.savedAt = Date.now() - 11 * 60 * 1000;
      sessionStorage.setItem(key, JSON.stringify(entry));
    }
  });
  await page.reload();
  await expect(page.getByRole("img", { name: "Alpha poster" })).toBeVisible();
  await expect.poll(() => hits).toBe(2);
  await expect(page.getByText("Loading movie listings…")).toHaveCount(0);
});
