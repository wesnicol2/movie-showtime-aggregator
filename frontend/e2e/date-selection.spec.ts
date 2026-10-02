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

function isoDate(daysFromToday: number): string {
  const value = new Date();
  value.setHours(12, 0, 0, 0);
  value.setDate(value.getDate() + daysFromToday);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

test("selecting a calendar day loads that date's movie dataset", async ({ page }) => {
  const requestedDates = await mockScreenings(page);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Plan your movie week" })).toBeVisible();
  const futureDate = isoDate(3);
  const targetDay = page.locator(`[data-date="${futureDate}"]`);
  await expect(targetDay).toBeVisible();
  await targetDay.getByRole("button", { name: "Choose movies" }).click();

  await expect(page).toHaveURL(/\/movies$/);
  await expect(page.getByRole("heading", { name: "Choose movies" })).toBeVisible();
  await expect.poll(() => requestedDates.at(-1)).toBe(futureDate);

  await page.getByRole("button", { name: "Calendar", exact: true }).first().click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator(`[data-date="${futureDate}"]`)).toBeVisible();
});
