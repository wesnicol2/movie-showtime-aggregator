import { expect, test } from "@playwright/test";

const commit = "0123456789abcdef0123456789abcdef01234567";

function build(tag: string | null) {
  return {
    commit,
    commit_short: "0123456",
    source: "image",
    dirty: false,
    image_tag: tag,
    branch: "feature/amc-ticket-links",
    commit_at: "2026-10-15T01:32:00+00:00",
    built_at: "2026-10-15T01:35:00Z",
  };
}

test("Test image shows exact commit and commit timestamp in a fixed badge", async ({ page }) => {
  await page.route("**/health", async (route) => {
    await route.fulfill({ json: { status: "ok", build: build("test") } });
  });
  await page.goto("/plan");
  const badge = page.getByRole("complementary", { name: "Test build" });
  await expect(badge).toBeVisible();
  await expect(badge).toContainText("TEST");
  await expect(badge).toContainText("0123456");
  await expect(badge).toContainText("Updated 2026-10-15 01:32:00 UTC");
  await expect(badge).toHaveAttribute("title", /Image built 2026-10-15T01:35:00Z/);
  await expect(badge).toHaveCSS("position", "fixed");
});

test("Production image never shows a Test build badge", async ({ page }) => {
  await page.route("**/health", async (route) => {
    await route.fulfill({ json: { status: "ok", build: build("latest") } });
  });
  await page.goto("/");
  await expect(page.getByRole("complementary", { name: "Test build" })).toHaveCount(0);
});

test("Missing or unlabelled build does not falsely claim Test", async ({ page }) => {
  await page.route("**/health", async (route) => {
    await route.fulfill({ json: { status: "ok" } });
  });
  await page.goto("/plan");
  await expect(page.getByRole("complementary", { name: "Test build" })).toHaveCount(0);
});
