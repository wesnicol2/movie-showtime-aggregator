import { expect, test } from "@playwright/test";

test("a traveler can select a new city and home without changing the shared default", async ({
  context,
  page,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 39.75, longitude: -104.99 });
  await page.addInitScript(() => {
    localStorage.setItem(
      "movie-showtime-aggregator.settings.v1",
      JSON.stringify({ location: { zipCode: "85004", radiusMiles: 25 } }),
    );
  });

  await page.route("**/api/location/nearby?*", async (route) => {
    await route.fulfill({
      json: {
        display_name: "Downtown Denver, Colorado",
        city: "Denver, Colorado",
        zip_code: "80202",
        latitude: 39.75,
        longitude: -104.99,
        search_zip_code: "85004",
        radius_miles: 25,
        distance_from_search_miles: 580,
      },
    });
  });
  let sharedHomeWrites = 0;
  await page.route("**/api/settings", async (route) => {
    if (route.request().method() === "POST") sharedHomeWrites++;
    await route.fulfill({
      json: {
        home_address: "Phoenix AZ",
        home_display_name: "Phoenix AZ",
        home_configured: true,
        amc_vendor_key_set: false,
        omdb_api_key_set: false,
        amc_a_list: false,
        provider_usage: {},
        experience_deviations: [],
      },
    });
  });
  await page.route("**/api/screenings?*", async (route) => {
    const date = new URL(route.request().url()).searchParams.get("date");
    await route.fulfill({
      json: {
        date,
        market_zip: "80202",
        radius_miles: 25,
        location: { zip_code: "80202", radius_miles: 25 },
        preferences: { home_configured: true },
        preview_minutes_by_chain: {},
        enrichment_enabled: false,
        count: 0,
        total_count: 0,
        facets: { chains: [], movies: [], theatres: [], formats: [] },
        screenings: [],
      },
    });
  });

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Homes for this browser" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Travel location suggestion" })).toBeVisible();
  await page.getByRole("button", { name: "Add as home & search here" }).click();
  await expect(page.getByLabel("Active home address")).toContainText("Downtown Denver");
  await expect(page.getByLabel("ZIP code")).toHaveValue("80202");
  expect(sharedHomeWrites).toBe(0);

  const cookies = await context.cookies();
  const home = cookies.find((cookie) => cookie.name === "movie_home");
  const location = cookies.find((cookie) => cookie.name === "movie_location");
  expect(home).toBeDefined();
  expect(JSON.parse(decodeURIComponent(home?.value ?? "{}"))).toMatchObject({
    latitude: 39.75,
    longitude: -104.99,
  });
  expect(JSON.parse(decodeURIComponent(location?.value ?? "{}"))).toMatchObject({
    zipCode: "80202",
  });

  await page.reload();
  await expect(page.getByLabel("Active home address")).toContainText("Downtown Denver");
  await page.getByLabel("Active home address").selectOption("");
  const reloadedCookies = await context.cookies();
  expect(reloadedCookies.find((cookie) => cookie.name === "movie_home")).toBeUndefined();
  expect(sharedHomeWrites).toBe(0);
});

test("manual hotel address changes theater ZIP and can be removed without server writes", async ({
  page,
}) => {
  await page.route("**/api/location/geocode?*", async (route) => {
    await route.fulfill({
      json: {
        display_name: "Denver hotel, Colorado",
        latitude: 39.746,
        longitude: -104.998,
        zip_code: "80202",
      },
    });
  });
  await page.route("**/api/settings", async (route) => {
    await route.fulfill({
      json: {
        home_address: "",
        home_display_name: "",
        home_configured: false,
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
        date: new URL(route.request().url()).searchParams.get("date"),
        market_zip: "80202",
        radius_miles: 25,
        location: { zip_code: "80202", radius_miles: 25 },
        preferences: {},
        preview_minutes_by_chain: {},
        enrichment_enabled: false,
        count: 0,
        total_count: 0,
        facets: { chains: [] },
        screenings: [],
      },
    });
  });

  await page.goto("/settings");
  await page.getByLabel("Add another home or hotel address").fill("Denver hotel address");
  await page.getByRole("button", { name: "Add & use address" }).click();
  await expect(page.getByLabel("ZIP code")).toHaveValue("80202");
  await expect(page.getByLabel("Active home address")).toContainText("Denver hotel");
  await page.getByRole("button", { name: "Remove saved address Denver hotel, Colorado" }).click();
  await expect(page.getByLabel("Active home address")).not.toContainText("Denver hotel");
});
