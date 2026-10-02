import { expect, test } from "@playwright/test";

test("experience deviation settings save and survive reload", async ({ page }) => {
  let imaxEnabled = true;
  let imaxImpact = 1;

  await page.route("**/api/settings", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as {
        experience_deviations?: Array<{ id: string; enabled: boolean; score_delta: number }>;
      };
      const imax = body.experience_deviations?.find((item) => item.id === "format:imax");
      if (imax) {
        imaxEnabled = imax.enabled;
        imaxImpact = imax.score_delta;
      }
    }

    await route.fulfill({
      json: {
        home_address: "",
        home_display_name: "",
        home_configured: false,
        amc_vendor_key_set: false,
        omdb_api_key_set: false,
        amc_a_list: false,
        provider_usage: {},
        experience_deviations: [
          {
            id: "format:imax",
            label: "IMAX",
            category: "presentation",
            enabled: imaxEnabled,
            score_delta: imaxImpact,
            default_score_delta: 1,
          },
          {
            id: "seating:no-signature-recliners",
            label: "No Signature Recliners",
            category: "seating",
            enabled: true,
            score_delta: -1,
            default_score_delta: -1,
          },
        ],
      },
    });
  });

  await page.route("**/api/screenings?*", async (route) => {
    await route.fulfill({
      json: {
        date: "2026-10-02",
        market_zip: "85004",
        radius_miles: 25,
        location: { zip_code: "85004", radius_miles: 25 },
        preferences: {
          amc_vendor_key_set: false,
          omdb_api_key_set: false,
          amc_a_list: false,
          home_configured: false,
        },
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
  await expect(page.getByRole("heading", { name: "Experience deviations" })).toBeVisible();

  const impact = page.getByLabel("IMAX want-score impact");
  await expect(impact).toHaveValue("1");
  await impact.fill("4");
  await page.getByRole("button", { name: "Save experience deviations" }).click();
  await expect(page.getByRole("status")).toContainText("Experience deviations saved");

  await page.reload();
  await expect(page.getByLabel("IMAX want-score impact")).toHaveValue("4");

  await page.getByLabel("Enable IMAX").uncheck();
  await page.getByRole("button", { name: "Save experience deviations" }).click();
  await page.reload();

  await expect(page.getByLabel("Enable IMAX")).not.toBeChecked();
  await expect(page.getByLabel("IMAX want-score impact")).toBeDisabled();
});
