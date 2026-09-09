import { test, expect, type Page } from "@playwright/test";
import {
  buildConcert,
  mockConcerts,
  mockConcertsError,
  mockConcertQuery,
  mockConcertQueryError,
} from "../support/mock-api";

/**
 * JamSpot has one search field (TEA-51). A query that is nothing but a state
 * is answered straight from Ticketmaster; everything else goes through the
 * `concert-query` Edge Function first, which these tests mock.
 */
function searchField(page: Page) {
  return page.getByPlaceholder("Ask Luna");
}

async function search(page: Page, query: string) {
  await searchField(page).fill(query);
  await searchField(page).press("Enter");
}

test.describe("landing state", () => {
  test("shows the hero and a single search field before any search", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: "Find your next Jam" }),
    ).toBeVisible();
    await expect(searchField(page)).toBeVisible();
    await expect(searchField(page)).toHaveCount(1);
    await expect(page.getByText(/events?$/i)).toHaveCount(0);
  });

  test("has no separate keyword or location input", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByPlaceholder("Artist, venue, event, or genre..."),
    ).toHaveCount(0);
    await expect(page.getByPlaceholder("City or state")).toHaveCount(0);
  });
});

test.describe("searching by state, without Luna", () => {
  test("a two-letter state code goes straight to Ticketmaster", async ({
    page,
  }) => {
    await mockConcerts(page, [buildConcert()]);
    await page.goto("/");

    const request = page.waitForRequest(
      (req) =>
        req.url().includes("/api/concerts") && req.url().includes("stateCode=TX"),
    );
    // Any call to the Edge Function would fail this test: it is never routed,
    // so a request to it cannot be answered.
    await search(page, "TX");

    await request;
  });

  test("a full state name resolves to the same state code", async ({ page }) => {
    await mockConcerts(page, [buildConcert()]);
    await page.goto("/");

    const request = page.waitForRequest(
      (req) =>
        req.url().includes("/api/concerts") && req.url().includes("stateCode=TX"),
    );
    await search(page, "Texas");

    await request;
  });

  test("renders every concert the state search returns", async ({ page }) => {
    await mockConcerts(page, [
      buildConcert({ id: "1", artist: "Nova Bloom", genre: "Rock" }),
      buildConcert({ id: "2", artist: "Silver Echo", genre: "Jazz" }),
    ]);

    await page.goto("/");
    await search(page, "TX");

    await expect(page.getByRole("heading", { name: "Nova Bloom" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Silver Echo" })).toBeVisible();
    await expect(page.getByText("2 events")).toBeVisible();
    await expect(
      page.getByText("Upcoming live music across Texas."),
    ).toBeVisible();
  });

  test("moves the search field into the header once results are showing", async ({
    page,
  }) => {
    await mockConcerts(page, [buildConcert()]);
    await page.goto("/");
    await search(page, "TX");

    await expect(page.getByText("1 event")).toBeVisible();
    // Still exactly one field, still carrying what was typed.
    await expect(searchField(page)).toHaveCount(1);
    await expect(searchField(page)).toHaveValue("TX");
    await expect(page.locator("header").getByPlaceholder("Ask Luna")).toBeVisible();
  });
});

test.describe("searching through Luna", () => {
  test("hands the Edge Function's parameters to the concerts route", async ({
    page,
  }) => {
    await mockConcerts(page, [buildConcert({ artist: "Cobalt Sky" })]);
    await mockConcertQuery(page, {
      ticketmasterParams: { classificationName: "Jazz", city: "Dallas" },
      filters: { maxPrice: 60 },
      interpretation: "Jazz around Dallas under $60.",
    });

    await page.goto("/");

    const request = page.waitForRequest((req) => req.url().includes("/api/concerts"));
    await search(page, "chill jazz under $60 in Dallas");

    const url = (await request).url();
    expect(url).toContain("classificationName=Jazz");
    expect(url).toContain("city=Dallas");
    expect(url).toContain("maxPrice=60");

    await expect(
      page.getByText("Jazz around Dallas under $60."),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Cobalt Sky" })).toBeVisible();
  });

  test("shows the refusal for a query that isn't about live music", async ({
    page,
  }) => {
    await mockConcerts(page, [buildConcert()]);
    await mockConcertQueryError(
      page,
      "JamSpot searches live music. Try an artist, a genre, a city, or a state.",
      "out_of_scope",
    );

    await page.goto("/");
    await search(page, "who won the game last night");

    // Scoped to the field's own alert - Next renders a route announcer with
    // role="alert" too.
    await expect(
      page.getByRole("alert").filter({ hasText: "JamSpot searches live music" }),
    ).toBeVisible();
    // Refused before anything was searched, so the hero is still on screen.
    await expect(
      page.getByRole("heading", { name: "Find your next Jam" }),
    ).toBeVisible();
  });

  test("refuses an empty query without calling anything", async ({ page }) => {
    await page.goto("/");
    await search(page, "   ");

    await expect(
      page.getByRole("alert").filter({ hasText: "Search for a show" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Find your next Jam" }),
    ).toBeVisible();
  });
});

test.describe("result states", () => {
  test("shows an empty state when no concerts match", async ({ page }) => {
    await mockConcerts(page, []);
    await page.goto("/");

    await search(page, "Wyoming");

    await expect(
      page.getByText("No shows found. Try a different search."),
    ).toBeVisible();
  });

  test("shows an error state when the concerts request fails", async ({ page }) => {
    await mockConcertsError(page, "Ticketmaster is unavailable", 502);
    await page.goto("/");

    await search(page, "TX");

    await expect(page.getByText("Ticketmaster is unavailable")).toBeVisible();
  });
});

test.describe("filtering and paging results", () => {
  test("genre chips filter results client-side", async ({ page }) => {
    await mockConcerts(page, [
      buildConcert({ id: "1", artist: "Cobalt Sky", genre: "Rock" }),
      buildConcert({ id: "2", artist: "Midnight Reed", genre: "Jazz" }),
    ]);

    await page.goto("/");
    await search(page, "TX");

    await expect(page.getByRole("heading", { name: "Cobalt Sky" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Midnight Reed" })).toBeVisible();

    await page.getByRole("button", { name: "Jazz", exact: true }).click();

    await expect(page.getByRole("heading", { name: "Midnight Reed" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Cobalt Sky" })).toHaveCount(0);
    await expect(page.getByText("1 event")).toBeVisible();

    await page.getByRole("button", { name: "All", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Cobalt Sky" })).toBeVisible();
  });

  test("show more reveals additional results", async ({ page }) => {
    const concerts = Array.from({ length: 9 }, (_, i) =>
      buildConcert({ id: `${i + 1}`, artist: `Artist ${i + 1}` }),
    );
    await mockConcerts(page, concerts);

    await page.goto("/");
    await search(page, "TX");

    await expect(page.getByText("9 events")).toBeVisible();
    await expect(page.getByRole("listitem")).toHaveCount(6);

    await page.getByRole("button", { name: /Show more/i }).click();

    await expect(page.getByRole("listitem")).toHaveCount(9);
    await expect(page.getByRole("button", { name: /Show more/i })).toHaveCount(0);
  });
});
