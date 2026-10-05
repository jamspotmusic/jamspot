import { cache } from "react";

import {
  searchConcerts,
  TicketmasterApiError,
  type NormalizedConcert,
} from "@/lib/ticketmaster";
import type { DiscoveryCity, DiscoveryGenre } from "@/lib/discovery/taxonomy";

/**
 * The discovery pages' view of the Ticketmaster data layer (TEA-67).
 *
 * Every discovery route reads events through here, and here calls
 * lib/ticketmaster.ts - the same client, Data Cache entries, and rate-limit
 * budget the /api/concerts route and the Luna search already use. There is no
 * second, SEO-only Ticketmaster client.
 *
 * Two layers of caching sit under these functions, and they do different jobs:
 *
 *   - React `cache()` dedupes *within one render*. `generateMetadata` and the
 *     page component both need the same events, and without this they would
 *     each issue their own request. With it, the second call is a cache hit on
 *     an in-flight promise.
 *   - Next's Data Cache dedupes *across requests and instances*, via the
 *     `next: { revalidate }` option lib/ticketmaster.ts already sets. That is
 *     what keeps a popular city page off Ticketmaster on most renders.
 */

/**
 * Events per discovery page.
 *
 * One request, one page of results: enough to fill a city page without paging,
 * and a hard ceiling on what any single route can spend.
 */
export const DISCOVERY_PAGE_SIZE = 40;

/**
 * Below this, a page isn't worth indexing.
 *
 * One upcoming show is a real answer to "what's on in San Diego" and worth
 * serving, so the threshold is about *emptiness*, not volume - see
 * `isIndexable` in lib/discovery/metadata.ts.
 */
export const MIN_INDEXABLE_EVENTS = 1;

/** What a discovery route gets back. */
export type DiscoveryEvents = {
  concerts: NormalizedConcert[];
  /**
   * True when Ticketmaster could not be reached or refused the request.
   *
   * Kept distinct from "no upcoming events": both render the same empty state,
   * but an outage must never be published as a durable "nothing on here" - the
   * page is noindex either way, and the sitemap drops it either way.
   */
  unavailable: boolean;
};

const EMPTY: DiscoveryEvents = { concerts: [], unavailable: true };

/**
 * `startDateTime` for "upcoming", to the hour.
 *
 * Truncating to the hour is what makes the Data Cache useful at all: a
 * to-the-second timestamp would put a fresh parameter in every request URL, so
 * every render would miss the cache and hit Ticketmaster.
 */
function upcomingFrom(now: Date = new Date()): string {
  const hour = new Date(now);
  hour.setUTCMinutes(0, 0, 0);
  return hour.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Run one discovery search, turning a Ticketmaster failure into an empty,
 * non-indexable result rather than a 500.
 *
 * A discovery page whose upstream is down should still render its heading,
 * its navigation, and an honest empty state - and should not be indexed in
 * that state. Throwing here would instead surface the error page to a crawler.
 */
async function runSearch(
  params: Parameters<typeof searchConcerts>[0]
): Promise<DiscoveryEvents> {
  try {
    const concerts = await searchConcerts({
      size: DISCOVERY_PAGE_SIZE,
      sort: "date,asc",
      startDateTime: upcomingFrom(),
      ...params,
    });

    return { concerts, unavailable: false };
  } catch (err) {
    if (err instanceof TicketmasterApiError) return EMPTY;
    throw err;
  }
}

/** Upcoming music events in a city. */
export const getCityEvents = cache(
  async (city: DiscoveryCity): Promise<DiscoveryEvents> =>
    runSearch({
      city: city.name,
      stateCode: city.stateCode,
      // State codes aren't globally unique - without this, "WA" is Washington
      // and Western Australia both.
      countryCode: "US",
    })
);

/**
 * Upcoming events in a city, narrowed to one genre.
 *
 * Both constraints come from the URL and nothing else. Stored preferences and
 * Luna's inference deliberately have no say here: an indexed page has to show
 * every visitor - and every crawler - the same thing its URL claims.
 */
export const getCityGenreEvents = cache(
  async (
    city: DiscoveryCity,
    genre: DiscoveryGenre
  ): Promise<DiscoveryEvents> =>
    runSearch({
      city: city.name,
      stateCode: city.stateCode,
      countryCode: "US",
      classificationName: genre.classificationName,
    })
);

/** Upcoming events for one Ticketmaster attraction, by id. */
export const getArtistEvents = cache(
  async (attractionId: string): Promise<DiscoveryEvents> =>
    runSearch({ attractionId })
);

/** Upcoming events at one Ticketmaster venue, by id. */
export const getVenueEvents = cache(
  async (venueId: string): Promise<DiscoveryEvents> =>
    runSearch({ venueId })
);
