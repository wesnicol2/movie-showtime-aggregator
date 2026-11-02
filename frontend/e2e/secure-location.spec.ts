import { expect, test } from "@playwright/test";

test("insecure HTTP origins never call device geolocation and offer a ZIP fallback", async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: false,
    });
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      get: () => {
        throw new Error("Geolocation must not be accessed on insecure origins");
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
    const location = (await context.cookies()).find((cookie) => cookie.name === "movie_location");
    const zipCode = location
      ? (JSON.parse(decodeURIComponent(location.value)) as { zipCode: string }).zipCode
      : "85004";
    await route.fulfill({
      json: {
        date: new URL(route.request().url()).searchParams.get("date"),
        market_zip: zipCode,
        radius_miles: 25,
        location: { zip_code: zipCode, radius_miles: 25 },
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
  await expect(page.getByRole("button", { name: "Set location" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Use current location" })).toHaveCount(0);
  await page.getByRole("button", { name: "Set location" }).click();
  const form = page.getByRole("region", { name: "Set theater location manually" });
  await expect(form.getByText("Automatic location needs HTTPS")).toBeVisible();
  await expect(form.getByText("Browsers block device location here", { exact: false })).toBeVisible();
  await form.getByLabel("Theater ZIP code").fill("80");
  await form.getByRole("button", { name: "Search here" }).click();
  await expect(page.getByRole("alert").first()).toContainText("five-digit US ZIP");
  await form.getByLabel("Theater ZIP code").fill("80202");
  await form.getByRole("button", { name: "Search here" }).click();
  await expect(form).toHaveCount(0);
  await expect(page.getByLabel("ZIP code", { exact: true })).toHaveValue("80202");
  expect(sharedHomeWrites).toBe(0);

  const cookies = await context.cookies();
  const location = cookies.find((cookie) => cookie.name === "movie_location");
  expect(JSON.parse(decodeURIComponent(location?.value ?? "{}"))).toMatchObject({
    zipCode: "80202",
  });
  expect(cookies.find((cookie) => cookie.name === "movie_home")).toBeUndefined();

  await page.reload();
  await expect(page.getByLabel("ZIP code", { exact: true })).toHaveValue("80202");
  await page.getByRole("button", { name: "Set location" }).click();
  await expect(
    page.getByRole("link", { name: "Add a home or hotel address in Settings" }),
  ).toHaveAttribute("href", "/settings");
});
