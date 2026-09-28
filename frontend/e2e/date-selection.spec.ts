import { expect, type Page, test } from "@playwright/test";

function screeningsPayload(date: string) {
  return {
    date,
    market_zip: "85004",
    radius_miles: 15,
    location: { zip_code: "85004", radius_miles: 15 },
    preferences: {
      amc_vendor_key_set: false,
      omdb_api_key_set: false,
      amc_a_list: false,
      home_configured: false,
    },
    preview_minutes_by_chain: {},
    enrichment_enabled: true,
    count: 0,
    total_count: 0,
    facets: { chains: [], movies: [], theatres: [], formats: [] },
    screenings: [],
  };
}

async function mockScreenings(page: Page): Promise<string[]> {
  const requestedDates: string[] = [];
  await page.route("**/api/screenings?*", async (route) => {
    const url = new URL(route.request().url());
    const date = url.searchParams.get("date") ?? "";
    requestedDates.push(date);
    await route.fulfill({ json: screeningsPayload(date) });
  });
  return requestedDates;
}

test("a specific show date refetches the shared screening dataset", async ({ page }) => {
  const requestedDates = await mockScreenings(page);
  await page.goto("/");

  const dateInput = page.getByLabel("Show date");
  await expect(dateInput).toBeVisible();
  await expect.poll(() => requestedDates.length).toBeGreaterThan(0);

  const futureDate = await page.evaluate(() => {
    const value = new Date();
    value.setDate(value.getDate() + 3);
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  });

  await dateInput.fill(futureDate);
  await expect.poll(() => requestedDates.at(-1)).toBe(futureDate);
  await expect(dateInput).toHaveValue(futureDate);
  await expect(page.getByRole("button", { name: "Today" })).toBeVisible();

  await page.getByRole("button", { name: "Movies" }).click();
  await expect(page.getByLabel("Show date")).toHaveValue(futureDate);

  await page.getByRole("button", { name: "Today" }).click();
  await expect(page.getByRole("button", { name: "Today" })).toHaveCount(0);
  await expect.poll(() => requestedDates.at(-1)).not.toBe(futureDate);
});
