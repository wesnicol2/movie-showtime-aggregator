import { expect, type Page, test } from "@playwright/test";

function screeningsPayload(homeConfigured: boolean) {
  return {
    date: "2026-09-30",
    market_zip: "85004",
    radius_miles: 15,
    location: { zip_code: "85004", radius_miles: 15 },
    preferences: {
      amc_vendor_key_set: false,
      omdb_api_key_set: false,
      amc_a_list: false,
      home_configured: homeConfigured,
    },
    preview_minutes_by_chain: {},
    enrichment_enabled: true,
    count: 0,
    total_count: 0,
    facets: { chains: [], movies: [], theatres: [], formats: [] },
    screenings: [],
  };
}

async function mockScreenings(page: Page, homeConfigured: boolean): Promise<void> {
  await page.route("**/api/screenings?*", async (route) => {
    await route.fulfill({ json: screeningsPayload(homeConfigured) });
  });
}

test("Movie Day warns when home is not configured", async ({ page }) => {
  await mockScreenings(page, false);

  await page.goto("/plan");

  await expect(page.getByText("Warning: no home address is set.")).toBeVisible();
  await expect(page.getByText(/Home by.*falls back to the final movie.*end time/i)).toBeVisible();
  await expect(page.getByRole("link", { name: "Set a home address" })).toHaveAttribute(
    "href",
    "/settings",
  );
});

test("Movie Day does not show the fallback warning when home is configured", async ({ page }) => {
  await mockScreenings(page, true);

  await page.goto("/plan");

  await expect(page.getByText("Warning: no home address is set.")).toHaveCount(0);
});
