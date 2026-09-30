import { type CDPSession, expect, type Page, test } from "@playwright/test";

const baseScreening = {
  chain: "AMC",
  format: "Standard",
  distance_miles: 4,
  movie_source_id: "movie",
  drive_to_minutes: 10,
  drive_home_minutes: 10,
  leave_home: null,
  home_arrival: null,
  poster_url: "",
  imdb_id: "",
  imdb_rating: null,
  metacritic_score: null,
  rotten_tomatoes_score: null,
  initial_release_date: null,
  ticket_price: null,
  seats_left_percent: null,
  amc_a_list_eligible: null,
  amc_source_url: "",
  letterboxd_url: "",
  imdb_url: "",
  rotten_tomatoes_url: "",
  metacritic_url: "",
  route_source_url: "",
};

const screenings = [
  {
    ...baseScreening,
    showtime_id: "alpha-1",
    movie: "Alpha",
    theatre: "AMC Center 8",
    advertised_start: "2026-09-10T08:35:00",
    actual_start: "2026-09-10T09:00:00",
    estimated_end: "2026-09-10T11:00:00",
    runtime_minutes: 120,
    purchase_url: "https://example.test/alpha",
    theatre_latitude: 33.45,
    theatre_longitude: -112.07,
  },
  {
    ...baseScreening,
    showtime_id: "beta-1",
    movie: "Beta",
    theatre: "AMC Valley 12",
    advertised_start: "2026-09-10T11:05:00",
    actual_start: "2026-09-10T11:30:00",
    estimated_end: "2026-09-10T13:10:00",
    runtime_minutes: 100,
    purchase_url: "https://example.test/beta",
    theatre_latitude: 33.5,
    theatre_longitude: -112.1,
  },
];

interface Point {
  x: number;
  y: number;
}

interface ActivePress {
  touch: boolean;
  session: CDPSession | null;
}

async function mockScreenings(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem(
      "movie-showtime-aggregator.selected-movies.v1",
      JSON.stringify(["Alpha", "Beta"]),
    );
    localStorage.removeItem("movie-showtime-aggregator.movie-day-preferences.v1");
  });
  await page.route("**/api/screenings?*", async (route) => {
    await route.fulfill({
      json: {
        date: "2026-09-10",
        market_zip: "85004",
        radius_miles: 25,
        location: { zip_code: "85004", radius_miles: 25 },
        preferences: {
          amc_vendor_key_set: false,
          omdb_api_key_set: false,
          amc_a_list: false,
          home_configured: true,
        },
        preview_minutes_by_chain: { AMC: 25 },
        enrichment_enabled: true,
        count: 2,
        total_count: 2,
        facets: {
          chains: ["AMC"],
          movies: ["Alpha", "Beta"],
          theatres: ["AMC Center 8", "AMC Valley 12"],
          formats: ["Standard"],
        },
        screenings,
      },
    });
  });
}

async function startPress(page: Page, point: Point): Promise<ActivePress> {
  const touch = await page.evaluate(() => navigator.maxTouchPoints > 0);
  if (!touch) {
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    return { touch: false, session: null };
  }

  const session = await page.context().newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [point],
  });
  return { touch: true, session };
}

async function movePress(page: Page, press: ActivePress, point: Point): Promise<void> {
  if (!press.touch) {
    await page.mouse.move(point.x, point.y, { steps: 4 });
    return;
  }
  if (!press.session) throw new Error("Touch session is missing");
  await press.session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [point],
  });
}

async function endPress(page: Page, press: ActivePress): Promise<void> {
  if (!press.touch) {
    await page.mouse.up();
    return;
  }
  if (!press.session) throw new Error("Touch session is missing");
  await press.session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await press.session.detach();
}

test("Movie Day reorder requires a hold and floats the dragged movie into position", async ({
  page,
}) => {
  await mockScreenings(page);
  await page.goto("/plan");

  await expect(page.getByText("Home by", { exact: true })).toBeVisible();

  const rows = page.locator("[data-movie-priority-row]");
  await expect(rows.nth(0)).toContainText("Alpha");
  await expect(rows.nth(1)).toContainText("Beta");

  const betaHandle = page.getByRole("button", { name: "Hold and drag Beta to reorder" });
  const alphaRow = rows.nth(0);
  await betaHandle.evaluate((element) => element.scrollIntoView({ block: "center" }));

  const quickHandleBox = await betaHandle.boundingBox();
  const quickAlphaBox = await alphaRow.boundingBox();
  if (!quickHandleBox || !quickAlphaBox) throw new Error("Movie priority rows are not measurable");
  const quickStart = {
    x: quickHandleBox.x + quickHandleBox.width / 2,
    y: quickHandleBox.y + quickHandleBox.height / 2,
  };
  const quickEnd = {
    x: quickStart.x,
    y: quickAlphaBox.y + quickAlphaBox.height / 2,
  };

  const quickPress = await startPress(page, quickStart);
  await page.waitForTimeout(75);
  await movePress(page, quickPress, quickEnd);
  await endPress(page, quickPress);

  await expect(rows.nth(0)).toContainText("Alpha");
  await expect(rows.nth(1)).toContainText("Beta");

  const holdHandleBox = await betaHandle.boundingBox();
  const holdAlphaBox = await alphaRow.boundingBox();
  if (!holdHandleBox || !holdAlphaBox) throw new Error("Movie priority rows are not measurable");
  const holdStart = {
    x: holdHandleBox.x + holdHandleBox.width / 2,
    y: holdHandleBox.y + holdHandleBox.height / 2,
  };
  const holdEnd = {
    x: holdStart.x,
    y: holdAlphaBox.y + holdAlphaBox.height / 2,
  };

  const heldPress = await startPress(page, holdStart);
  await page.waitForTimeout(550);
  await expect(rows.nth(1)).toHaveClass(/is-dragging/);
  await movePress(page, heldPress, holdEnd);
  await expect(rows.nth(0)).toHaveClass(/is-shifting/);
  await endPress(page, heldPress);

  await expect(rows.nth(0)).toContainText("Beta");
  await expect(rows.nth(1)).toContainText("Alpha");
});
