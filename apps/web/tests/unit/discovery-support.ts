import assert from "node:assert/strict";

import type { NormalizedConcert } from "../../lib/ticketmaster";

/**
 * Shared fixtures and fetch plumbing for the discovery-page tests (TEA-67).
 *
 * Not a *.test.ts file, so the runner compiles it but never executes it as a
 * suite - see testFiles() in scripts/ui-test-runner-lib.mjs.
 */

/** A Ticketmaster event payload, with everything the normalizer reads. */
export function tmEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt-1",
    name: "Nova Bloom Live",
    url: "https://tickets.example.com/nova",
    images: [{ url: "https://img.example.com/nova.jpg", ratio: "16_9", width: 2048 }],
    classifications: [{ genre: { name: "Alternative" }, subGenre: { name: "Indie Rock" } }],
    priceRanges: [{ min: 40, max: 120, currency: "USD" }],
    dates: { start: { localDate: "2026-09-15", localTime: "19:30:00" } },
    _embedded: {
      venues: [
        {
          id: "venue-granada",
          name: "The Granada",
          city: { name: "San Diego" },
          state: { stateCode: "CA" },
          country: { countryCode: "US" },
        },
      ],
      attractions: [{ id: "attr-nova", name: "Nova Bloom" }],
    },
    ...overrides,
  };
}

/** A normalized concert, for the pure builders that take one directly. */
export function concert(
  overrides: Partial<NormalizedConcert> = {},
): NormalizedConcert {
  return {
    id: "evt-1",
    name: "Nova Bloom Live",
    artist: "Nova Bloom",
    artistId: "attr-nova",
    venue: "The Granada",
    venueId: "venue-granada",
    city: "San Diego",
    state: "CA",
    date: "2026-09-15",
    time: "19:30:00",
    imageUrl: "https://img.example.com/nova.jpg",
    ticketUrl: "https://tickets.example.com/nova",
    genre: "Alternative",
    subGenre: "Indie Rock",
    priceRange: { min: 40, max: 120, currency: "USD" },
    ...overrides,
  };
}

export type FetchLog = {
  /** Every URL requested, in order. */
  urls: string[];
  /**
   * The options each request carried, for cache assertions. Typed as Next's
   * own RequestInit, which is where the `next.revalidate` field comes from.
   */
  options: RequestInit[];
  restore: () => void;
};

/**
 * Stub global fetch with a router keyed on the Discovery API endpoint.
 *
 * `handlers` maps "events" | "attractions" | "venues" to the JSON body that
 * endpoint should answer with; anything unmapped answers with an empty
 * `_embedded`, so a test only has to describe the endpoint it cares about.
 */
export function stubTicketmaster(handlers: {
  events?: unknown | ((url: string) => unknown);
  attractions?: unknown;
  venues?: unknown;
  /** Status to fail every request with, for outage tests. */
  failWith?: number;
  /** Endpoints to fail, when only some of them should be down. */
  failEndpoints?: ("events" | "attractions" | "venues")[];
}): FetchLog {
  const originalFetch = globalThis.fetch;
  const log: FetchLog = {
    urls: [],
    options: [],
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };

  globalThis.fetch = (async (url: RequestInfo | URL, options?: RequestInit) => {
    const href = String(url);
    log.urls.push(href);
    log.options.push(options ?? {});

    const endpoint = href.includes("/attractions.json")
      ? "attractions"
      : href.includes("/venues.json")
        ? "venues"
        : "events";

    if (handlers.failWith || handlers.failEndpoints?.includes(endpoint)) {
      return {
        ok: false,
        status: handlers.failWith ?? 429,
        json: async () => ({}),
      } as Response;
    }

    const body = href.includes("/attractions.json")
      ? handlers.attractions
      : href.includes("/venues.json")
        ? handlers.venues
        : typeof handlers.events === "function"
          ? (handlers.events as (u: string) => unknown)(href)
          : handlers.events;

    return {
      ok: true,
      status: 200,
      json: async () => body ?? { _embedded: {} },
    } as Response;
  }) as typeof fetch;

  return log;
}

/** Run `fn` with TICKETMASTER_API_KEY set, restoring whatever was there. */
export async function withApiKey(fn: () => Promise<void>): Promise<void> {
  const original = process.env.TICKETMASTER_API_KEY;
  process.env.TICKETMASTER_API_KEY = "key-123";
  try {
    await fn();
  } finally {
    if (original === undefined) delete process.env.TICKETMASTER_API_KEY;
    else process.env.TICKETMASTER_API_KEY = original;
  }
}

/**
 * Assert that `fn` leaves the route via notFound().
 *
 * See tests/unit/register-next-navigation-stub.cjs for the digests - the real
 * notFound() throws too, so "did it throw the right thing" is the same
 * question in tests as it is in production.
 */
export async function assertNotFound(fn: () => Promise<unknown>): Promise<void> {
  await assert.rejects(fn, (err: Error) => {
    assert.match(err.message, /NEXT_HTTP_ERROR_FALLBACK;404/);
    return true;
  });
}

/** Assert that `fn` leaves the route by redirecting to `to`. */
export async function assertRedirect(
  fn: () => Promise<unknown>,
  to: string,
): Promise<void> {
  await assert.rejects(fn, (err: Error) => {
    assert.match(err.message, /^NEXT_REDIRECT/);
    assert.ok(
      err.message.includes(`;${to};`),
      `expected a redirect to ${to}, got ${err.message}`,
    );
    return true;
  });
}

/** The `<script type="application/ld+json">` payloads in rendered markup. */
export function extractJsonLd(html: string): unknown[] {
  const matches = [
    ...html.matchAll(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
    ),
  ];

  return matches.map((match) =>
    JSON.parse(match[1].replace(/\\u003c/g, "<")),
  );
}
