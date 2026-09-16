import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import DiscoveryLayout from "@/components/discovery/DiscoveryLayout";
import DiscoveryEventGrid from "@/components/discovery/DiscoveryEventGrid";
import JsonLd from "@/components/discovery/JsonLd";
import { DISCOVERY_SURFACES } from "@/lib/analytics/discovery-attribution";
import { getCityEvents } from "@/lib/discovery/events";
import {
  buildDiscoveryMetadata,
  describeDateRange,
  discoveryTitle,
  isIndexable,
  leadImage,
} from "@/lib/discovery/metadata";
import { isCanonicalSlug, normalizeSlugParam } from "@/lib/discovery/slug";
import { buildEventListJsonLd } from "@/lib/discovery/structured-data";
import { cityGenrePath, cityPath } from "@/lib/discovery/site";
import {
  DISCOVERY_GENRES,
  findCityBySlug,
  genresForClassification,
  type DiscoveryCity,
} from "@/lib/discovery/taxonomy";

/**
 * /concerts/[city] - a city's upcoming live music (TEA-67).
 *
 * Rendered on the server with the events already in the HTML, then cached and
 * revalidated, so a crawler and a first-time visitor both get the listings
 * without running the JamSpot client app or typing a search.
 */

/**
 * Half an hour, matching TICKETMASTER_CACHE_TTL_SECONDS' default in
 * lib/cache-config.ts. Written as a literal because Next requires this value
 * to be statically analyzable - it cannot read an imported const.
 */
export const revalidate = 1800;

/**
 * Only the busiest markets are built at deploy time. `dynamicParams` stays at
 * its default of true, so the rest of the registry renders on first request
 * and is then cached like any other - which is the point of not prebuilding
 * them: a city nobody visits costs nothing.
 */
export function generateStaticParams() {
  return [
    "new-york",
    "los-angeles",
    "chicago",
    "san-diego",
    "austin",
    "nashville",
    "seattle",
    "denver",
  ].map((city) => ({ city }));
}

type CityPageProps = { params: Promise<{ city: string }> };

/**
 * Resolve the route param, or leave the route.
 *
 * Three outcomes, and the difference between them matters for indexing:
 *   - a canonical slug for a registered city: render it;
 *   - an equivalent spelling ("San-Diego", "san--diego"): redirect, so only
 *     one URL is ever served a 200 and only one is ever indexed;
 *   - anything else: 404, without spending a Ticketmaster request on it.
 *
 * In practice proxy.ts has already normalized the spelling before the request
 * reaches here - it has to, because a redirect thrown during an incremental
 * regeneration gets cached as that path's prerender. The check is kept as the
 * route's own invariant, so the page stays correct if it is ever reached by
 * some path the proxy's matcher does not cover.
 */
function resolveCity(raw: string): DiscoveryCity {
  const slug = normalizeSlugParam(raw);
  const city = findCityBySlug(slug);

  if (!city) notFound();
  if (!isCanonicalSlug(raw)) redirect(cityPath(city));

  return city;
}

export async function generateMetadata({
  params,
}: CityPageProps): Promise<Metadata> {
  const { city } = await params;
  const resolved = resolveCity(city);

  // Same call the page body makes. React's cache() collapses the two into one
  // Ticketmaster request per render - see lib/discovery/events.ts.
  const events = await getCityEvents(resolved);

  return buildDiscoveryMetadata({
    title: discoveryTitle(`Concerts in ${resolved.name}, ${resolved.stateCode}`),
    description: `Find upcoming concerts and live music in ${resolved.name}, ${resolved.stateName}. Browse ${resolved.name} shows by date and genre, and get tickets through JamSpot.`,
    path: cityPath(resolved),
    indexable: isIndexable(events),
    imageUrl: leadImage(events.concerts),
  });
}

export default async function CityPage({ params }: CityPageProps) {
  const { city } = await params;
  const resolved = resolveCity(city);
  const events = await getCityEvents(resolved);

  const path = cityPath(resolved);
  const dateRange = describeDateRange(events.concerts);

  /**
   * Genres advertised below the listings are the ones this city's own results
   * actually contain. Linking all seventeen from every city would manufacture
   * links to pages we have no reason to think have anything on them.
   *
   * Both of an event's classifications are consulted, and each can match more
   * than one genre - an "Alternative Rock" show really is on the Alternative
   * page and the Rock page both.
   */
  const slugsInCity = new Set(
    events.concerts.flatMap((concert) =>
      [concert.genre, concert.subGenre]
        .flatMap(genresForClassification)
        .map((genre) => genre.slug)
    )
  );
  const genresInCity = DISCOVERY_GENRES.filter((genre) =>
    slugsInCity.has(genre.slug)
  );

  return (
    <DiscoveryLayout
      breadcrumbs={[
        { label: "JamSpot", href: "/" },
        { label: "Concerts", href: "/" },
        { label: resolved.name },
      ]}
    >
      <JsonLd data={buildEventListJsonLd(events.concerts, path)} />

      <header className="mb-8">
        <h1
          className="text-3xl lg:text-4xl font-black tracking-tight"
          style={{ fontFamily: "'Unbounded', sans-serif" }}
        >
          Concerts in {resolved.name}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {events.concerts.length > 0 ? (
            <>
              {events.concerts.length} upcoming{" "}
              {events.concerts.length === 1 ? "show" : "shows"} in{" "}
              {resolved.name}, {resolved.stateName}
              {dateRange ? ` · ${dateRange}` : "."}
            </>
          ) : (
            <>Live music in {resolved.name}, {resolved.stateName}.</>
          )}
        </p>
      </header>

      <DiscoveryEventGrid
        concerts={events.concerts}
        attribution={{
          surface: DISCOVERY_SURFACES.city,
          path,
          citySlug: resolved.slug,
        }}
        emptyMessage={
          events.unavailable
            ? `We can't load ${resolved.name} shows right now. Please try again shortly.`
            : `No upcoming shows listed in ${resolved.name} right now. Check back soon.`
        }
      />

      {genresInCity.length > 0 && (
        <section className="mt-12 border-t border-border pt-8">
          <h2
            className="text-sm font-bold uppercase tracking-wide text-muted-foreground mb-4"
            style={{ fontFamily: "'DM Mono', monospace" }}
          >
            Browse {resolved.name} by genre
          </h2>
          <ul className="flex flex-wrap gap-2">
            {genresInCity.map((genre) => (
              <li key={genre.slug}>
                <Link
                  href={cityGenrePath(resolved, genre)}
                  className="inline-block text-xs px-4 py-1.5 rounded-full border bg-muted border-border text-muted-foreground hover:border-primary/40 hover:text-foreground transition-all font-medium"
                  style={{ fontFamily: "'DM Mono', monospace" }}
                >
                  {genre.label}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </DiscoveryLayout>
  );
}
