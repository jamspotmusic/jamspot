import type { Page } from "@playwright/test";

/** Mirrors lib/ticketmaster.ts's NormalizedConcert shape. */
export type MockConcert = {
  id: string;
  name: string;
  artist: string | null;
  venue: string | null;
  city: string | null;
  state: string | null;
  date: string | null;
  time: string | null;
  imageUrl: string | null;
  ticketUrl: string | null;
  genre: string | null;
  subGenre: string | null;
  priceRange: { min: number; max: number; currency: string } | null;
};

let counter = 0;

/** Builds a fully-populated NormalizedConcert, with overrides for whatever a test cares about. */
export function buildConcert(overrides: Partial<MockConcert> = {}): MockConcert {
  counter += 1;
  return {
    id: `concert-${counter}`,
    name: `Test Show ${counter}`,
    artist: `Test Artist ${counter}`,
    venue: `Test Venue ${counter}`,
    city: "Dallas",
    state: "TX",
    date: "2026-09-15",
    time: "19:30:00",
    imageUrl: "https://picsum.photos/400/250?random=1",
    ticketUrl: "https://www.ticketmaster.com/event/test",
    genre: "Rock",
    subGenre: null,
    priceRange: { min: 40, max: 120, currency: "USD" },
    ...overrides,
  };
}

/** Intercepts the app's own /api/concerts route so tests don't depend on live Ticketmaster data. */
export async function mockConcerts(page: Page, concerts: MockConcert[]) {
  await page.route("**/api/concerts**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ concerts }),
    });
  });
}

export async function mockConcertsError(
  page: Page,
  message: string,
  status = 502,
) {
  await page.route("**/api/concerts**", async (route) => {
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify({ error: message }),
    });
  });
}

/**
 * Intercepts the `concert-query` Edge Function, which is what a query that
 * isn't a bare state goes through before it reaches /api/concerts. Keeps
 * these tests off Supabase and off OpenAI - a live call would cost a token
 * spend per test run and return something different every time.
 */
export async function mockConcertQuery(
  page: Page,
  body: {
    ticketmasterParams: Record<string, string | number>;
    interpretation?: string;
    filters?: Record<string, string | number>;
  },
) {
  await page.route("**/functions/v1/concert-query**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

/** The Edge Function refusing a query - an out-of-scope one, say. */
export async function mockConcertQueryError(
  page: Page,
  message: string,
  code?: string,
  status = 422,
) {
  await page.route("**/functions/v1/concert-query**", async (route) => {
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify({ error: message, ...(code ? { code } : {}) }),
    });
  });
}

type ArtistMockOptions = {
  bio?: {
    name: string;
    summary: string | null;
    content?: string | null;
    url?: string | null;
    listeners?: number | null;
  } | null;
  bioStatus?: number;
  spotify?: {
    id: string;
    name: string;
    url: string | null;
    imageUrl?: string | null;
    genres?: string[];
    followers?: number | null;
    popularity?: number | null;
  } | null;
  spotifyStatus?: number;
  appleMusic?: {
    id: number;
    name: string;
    url: string | null;
    primaryGenre?: string | null;
  } | null;
  appleMusicStatus?: number;
};

/**
 * Intercepts the three artist-enrichment routes the event modal fires
 * (Last.fm bio, Spotify, Apple Music) so modal tests aren't at the mercy of
 * three separate third-party APIs and their credentials.
 */
export async function mockArtist(page: Page, options: ArtistMockOptions = {}) {
  await page.route("**/api/artist/lastfm**", async (route) => {
    await route.fulfill({
      status: options.bioStatus ?? 200,
      contentType: "application/json",
      body: JSON.stringify(
        options.bioStatus && options.bioStatus >= 400
          ? { error: "Failed to load artist bio" }
          : { bio: options.bio ?? null },
      ),
    });
  });

  await page.route("**/api/artist/spotify**", async (route) => {
    await route.fulfill({
      status: options.spotifyStatus ?? 200,
      contentType: "application/json",
      body: JSON.stringify(
        options.spotifyStatus && options.spotifyStatus >= 400
          ? { error: "Failed to load Spotify artist" }
          : { artist: options.spotify ?? null },
      ),
    });
  });

  await page.route("**/api/artist/apple-music**", async (route) => {
    await route.fulfill({
      status: options.appleMusicStatus ?? 200,
      contentType: "application/json",
      body: JSON.stringify(
        options.appleMusicStatus && options.appleMusicStatus >= 400
          ? { error: "Failed to load Apple Music artist" }
          : { artist: options.appleMusic ?? null },
      ),
    });
  });
}
