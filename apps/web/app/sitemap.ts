import type { MetadataRoute } from "next";

import { resolveArtistSlug, resolveVenueSlug } from "@/lib/discovery/entities";
import { getCityEvents } from "@/lib/discovery/events";
import { isIndexable } from "@/lib/discovery/metadata";
import { toSlug } from "@/lib/discovery/slug";
import { absoluteUrl, artistPath, cityGenrePath, cityPath, venuePath } from "@/lib/discovery/site";
import {
  DISCOVERY_CITIES,
  genresForClassification,
  type DiscoveryCity,
  type DiscoveryGenre,
} from "@/lib/discovery/taxonomy";

/**
 * The JamSpot sitemap (TEA-67).
 *
 * The rule the whole file is built around: **only emit a URL we have just seen
 * have content.** 43 cities x 17 genres is 731 possible city/genre pages, and
 * listing all of them would be listing mostly-empty pages - the sitemap would
 * be asking Google to crawl exactly the thin content the indexing rules
 * elsewhere are careful not to publish.
 *
 * So the sitemap is *derived from one pass of real data*:
 *
 *   - one Ticketmaster request per registered city (43, bounded, and served
 *     from the Data Cache whenever the city pages themselves are warm);
 *   - a city page is listed only if that request returned events;
 *   - a city/genre page is listed only if events in that city carry that
 *     genre - read out of the response we already have, so it costs nothing;
 *   - artist and venue names come from the same events, which means every one
 *     of them has at least one upcoming show by construction.
 *
 * No extra request is made for any city or genre entry.
 *
 * Artist and venue entries are the exception, and they have to be. A slug
 * built from an event's *embedded* name does not always resolve against the
 * attractions/venues search endpoints the routes use - Ticketmaster does not
 * reliably index a room under the name it prints on that room's own events.
 * Measured against live data, roughly one in twenty guessed slugs was a 404.
 * Listing those would be listing broken URLs, so each candidate is resolved
 * through the very function its route uses, and it is the *resolved* entity's
 * canonical slug that gets emitted. That trades a longer tail for a shorter,
 * correct one; the tail stays reachable through the city pages, which remain
 * `follow` even when they are not indexed.
 */

/**
 * Regenerated hourly. More often would mean 43 Ticketmaster requests more
 * often for a file crawlers re-read far less frequently than that.
 */
export const revalidate = 3600;

/**
 * Ceilings on the long tail. A sitemap is a crawl-budget hint, not a database
 * dump; the acts and rooms appearing across the most cities are the ones worth
 * pointing a crawler at.
 *
 * These are also a request budget: each candidate costs one resolution, so the
 * whole file is at most MAX_ARTIST_URLS + MAX_VENUE_URLS + one per city. Those
 * lookups go through the Data Cache and are shared with the pages themselves,
 * so a warm site pays far less than the ceiling.
 */
const MAX_ARTIST_URLS = 100;
const MAX_VENUE_URLS = 100;

/** Resolutions in flight at once - enough to be quick, few enough to be polite. */
const RESOLVE_CONCURRENCY = 4;

/** How many cities an entity turned up in - the ranking signal for the caps. */
type EntityCount = { slug: string; count: number };

function bump(counts: Map<string, number>, slug: string): void {
  counts.set(slug, (counts.get(slug) ?? 0) + 1);
}

/** Highest count first, then slug, so the same data always yields the same file. */
function topSlugs(counts: Map<string, number>, limit: number): EntityCount[] {
  return [...counts.entries()]
    .map(([slug, count]) => ({ slug, count }))
    .sort((a, b) => b.count - a.count || (a.slug < b.slug ? -1 : 1))
    .slice(0, limit);
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const lastModified = new Date();

  const entries: MetadataRoute.Sitemap = [
    {
      url: absoluteUrl("/"),
      lastModified,
      changeFrequency: "daily",
      priority: 1,
    },
  ];

  const artistCounts = new Map<string, number>();
  const venueCounts = new Map<string, number>();

  // Sequential rather than Promise.all: 43 simultaneous requests is the kind
  // of burst Ticketmaster's rate limit exists to stop, and a sitemap has no
  // one waiting on it.
  for (const city of DISCOVERY_CITIES) {
    const events = await getCityEvents(city);

    // Covers the empty case and the upstream-failure case alike - neither is
    // a page worth pointing a crawler at.
    if (!isIndexable(events)) continue;

    entries.push({
      url: absoluteUrl(cityPath(city)),
      lastModified,
      changeFrequency: "daily",
      priority: 0.8,
    });

    entries.push(...genreEntries(city, events.concerts, lastModified));

    for (const concert of events.concerts) {
      // Slugs are taken from the names we hold, and the corresponding routes
      // resolve by exact name match - so a name that slugs cleanly is exactly
      // a name those routes will resolve.
      if (concert.artist) bump(artistCounts, toSlug(concert.artist));
      if (concert.venue) bump(venueCounts, toSlug(concert.venue));
    }
  }

  entries.push(
    ...(await verifiedEntries(
      topSlugs(artistCounts, MAX_ARTIST_URLS),
      async (slug) => (await resolveArtistSlug(slug))?.canonicalSlug ?? null,
      artistPath,
      lastModified
    ))
  );

  entries.push(
    ...(await verifiedEntries(
      topSlugs(venueCounts, MAX_VENUE_URLS),
      async (slug) => (await resolveVenueSlug(slug))?.canonicalSlug ?? null,
      venuePath,
      lastModified
    ))
  );

  return entries;
}

/**
 * Resolve each candidate slug and emit the entity's own canonical URL.
 *
 * Candidates that resolve to nothing are dropped - they are the slugs that
 * would 404. Candidates that resolve to a differently-spelled entity are
 * emitted under that entity's canonical slug rather than the guessed one, so
 * the sitemap never points at a URL that only redirects.
 */
async function verifiedEntries(
  candidates: readonly EntityCount[],
  resolve: (slug: string) => Promise<string | null>,
  toPath: (slug: string) => string,
  lastModified: Date
): Promise<MetadataRoute.Sitemap> {
  const resolved = new Set<string>();

  for (let i = 0; i < candidates.length; i += RESOLVE_CONCURRENCY) {
    const batch = candidates.slice(i, i + RESOLVE_CONCURRENCY);
    const slugs = await Promise.all(
      batch.map(({ slug }) => resolve(slug).catch(() => null))
    );

    for (const slug of slugs) {
      if (slug) resolved.add(slug);
    }
  }

  // Sorted so the same data always produces byte-identical output.
  return [...resolved].sort().map((slug) => ({
    url: absoluteUrl(toPath(slug)),
    lastModified,
    changeFrequency: "weekly" as const,
    priority: 0.6,
  }));
}

/**
 * The city/genre pages worth listing for one city.
 *
 * A genre is listed only when this city's own results contain it, read from
 * the events already fetched. That is what keeps the sitemap to *active*
 * combinations instead of every arithmetic one.
 */
export function genreEntries(
  city: DiscoveryCity,
  concerts: readonly { genre: string | null; subGenre: string | null }[],
  lastModified: Date
): MetadataRoute.Sitemap {
  const genres = new Map<string, DiscoveryGenre>();

  for (const concert of concerts) {
    // An event advertises every genre page it belongs on, through both of its
    // classifications - "Alternative Rock" as a sub-genre is what puts a show
    // on the /alternative page and the /rock page alike.
    for (const classification of [concert.genre, concert.subGenre]) {
      for (const genre of genresForClassification(classification)) {
        genres.set(genre.slug, genre);
      }
    }
  }

  return [...genres.values()]
    .sort((a, b) => (a.slug < b.slug ? -1 : 1))
    .map((genre) => ({
      url: absoluteUrl(cityGenrePath(city, genre)),
      lastModified,
      changeFrequency: "daily" as const,
      priority: 0.7,
    }));
}
