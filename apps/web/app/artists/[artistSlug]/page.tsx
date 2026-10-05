import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import DiscoveryLayout from "@/components/discovery/DiscoveryLayout";
import DiscoveryEventGrid from "@/components/discovery/DiscoveryEventGrid";
import JsonLd from "@/components/discovery/JsonLd";
import StreamingServiceLinks from "@/components/StreamingServiceLinks";
import { DISCOVERY_SURFACES } from "@/lib/analytics/discovery-attribution";
import { resolveArtistSlug } from "@/lib/discovery/entities";
import { getArtistEnrichment } from "@/lib/discovery/enrichment";
import { getArtistEvents } from "@/lib/discovery/events";
import {
  buildDiscoveryMetadata,
  describeDateRange,
  discoveryTitle,
  isIndexable,
  leadImage,
} from "@/lib/discovery/metadata";
import { normalizeSlugParam, toSlug } from "@/lib/discovery/slug";
import { buildEventListJsonLd } from "@/lib/discovery/structured-data";
import { artistPath, cityPath } from "@/lib/discovery/site";
import { findCityBySlug } from "@/lib/discovery/taxonomy";

/**
 * /artists/[artistSlug] - one act's upcoming shows (TEA-67).
 *
 * Identity is the Ticketmaster attraction id, not the name in the URL. The
 * slug only ever selects an attraction whose own name slugifies back to it
 * exactly; everything after that - the events, the canonical, the structured
 * data - keys off the id. So "the-national" cannot quietly become a page about
 * a Tom Petty tribute act that happens to match the keyword search.
 */

/**
 * Rendered per request, unlike the city and venue routes.
 *
 * Not a preference - a constraint. This page's Spotify enrichment ultimately
 * depends on Spotify's client-credentials token request, which lib/spotify.ts
 * deliberately marks `cache: "no-store"` so an auth token never lands in a
 * shared cache. An uncacheable fetch in the dependency chain makes the route
 * impossible to statically regenerate, and Next fails the render outright
 * ("Page changed from static to dynamic at runtime") rather than quietly
 * degrading. The options were to reverse that security decision, to drop the
 * streaming links out of the server-rendered HTML, or to render per request.
 *
 * Per request costs the least. Everything expensive is still cached: the
 * attraction lookup, the events, the Last.fm bio, and the Apple Music lookup
 * all go through Next's Data Cache, so repeated crawls of this page hit
 * Ticketmaster and the enrichment providers no more often than an ISR page
 * would. What is repeated is HTML rendering, which is cheap - and the HTML is
 * still fully server-rendered, which is the part crawlers care about.
 */
export const dynamic = "force-dynamic";

type ArtistPageProps = { params: Promise<{ artistSlug: string }> };

/**
 * Resolve the slug to an attraction, or leave the route.
 *
 * No exact match means no stable artist identity, and the acceptance criteria
 * are explicit that we then publish no page at all rather than an indexable
 * page about a guess.
 */
async function resolveArtist(raw: string) {
  const slug = normalizeSlugParam(raw);
  if (!slug) notFound();

  const resolved = await resolveArtistSlug(slug);
  if (!resolved) notFound();

  /**
   * Deliberately no redirect when `raw` differs from the entity's own slug.
   *
   * proxy.ts has already normalized spelling, so the only way to get here is
   * an alternate name Ticketmaster itself uses for the entity (see
   * pickEntityMatch). Those render at 200 and point `<link rel="canonical">`
   * at the entity's canonical path instead - which consolidates the duplicate
   * onto one indexed URL without a redirect. That matters because these
   * routes are incrementally regenerated, and a redirect thrown during
   * regeneration is cached as the path's prerender.
   */
  return resolved;
}

export async function generateMetadata({
  params,
}: ArtistPageProps): Promise<Metadata> {
  const { artistSlug } = await params;
  const { attraction, canonicalSlug } = await resolveArtist(artistSlug);
  const events = await getArtistEvents(attraction.id);

  const description =
    events.concerts.length > 0
      ? `See ${attraction.name}'s ${events.concerts.length} upcoming tour dates, venues, and ticket links on JamSpot.`
      : `${attraction.name} tour dates, venues, and ticket links on JamSpot.`;

  return buildDiscoveryMetadata({
    title: discoveryTitle(`${attraction.name} Tour Dates & Tickets`),
    description,
    path: artistPath(canonicalSlug),
    indexable: isIndexable(events),
    imageUrl: attraction.imageUrl ?? leadImage(events.concerts),
  });
}

export default async function ArtistPage({ params }: ArtistPageProps) {
  const { artistSlug } = await params;
  const { attraction, canonicalSlug } = await resolveArtist(artistSlug);

  // Both are independent of each other, so they overlap rather than queue.
  const [events, enrichment] = await Promise.all([
    getArtistEvents(attraction.id),
    getArtistEnrichment(attraction.name),
  ]);

  const path = artistPath(canonicalSlug);
  const dateRange = describeDateRange(events.concerts);
  const heroImage = attraction.imageUrl ?? leadImage(events.concerts);

  /**
   * Cities this act is playing that JamSpot has a discovery page for. Built
   * from the events on this very page, so every link points somewhere with at
   * least one show on it.
   */
  const cityLinks = [
    ...new Map(
      events.concerts
        .map((concert) => findCityBySlug(concert.city ? toSlug(concert.city) : null))
        .filter((city): city is NonNullable<typeof city> => city !== null)
        .map((city) => [city.slug, city] as const)
    ).values(),
  ];

  return (
    <DiscoveryLayout
      breadcrumbs={[
        { label: "JamSpot", href: "/" },
        { label: "Artists", href: "/" },
        { label: attraction.name },
      ]}
    >
      <JsonLd data={buildEventListJsonLd(events.concerts, path)} />

      <header className="mb-8 flex flex-col sm:flex-row sm:items-end gap-6">
        {heroImage && (
          <div className="relative h-40 w-40 shrink-0 overflow-hidden rounded-xl bg-muted">
            <Image
              src={heroImage}
              alt={`${attraction.name} live`}
              fill
              sizes="160px"
              className="object-cover"
            />
          </div>
        )}

        <div>
          <h1
            className="text-3xl lg:text-4xl font-black tracking-tight"
            style={{ fontFamily: "'Unbounded', sans-serif" }}
          >
            {attraction.name}
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            {events.concerts.length > 0 ? (
              <>
                {events.concerts.length} upcoming{" "}
                {events.concerts.length === 1 ? "date" : "dates"}
                {dateRange ? ` · ${dateRange}` : "."}
              </>
            ) : (
              <>No dates currently on sale through Ticketmaster.</>
            )}
          </p>
          {attraction.genre && (
            <p
              className="mt-2 text-xs text-muted-foreground"
              style={{ fontFamily: "'DM Mono', monospace" }}
            >
              {[attraction.genre, attraction.subGenre]
                .filter((value) => value && value !== "Undefined")
                .join(" · ")}
            </p>
          )}
        </div>
      </header>

      {/* TEA-22: Last.fm biography, server-rendered so it is part of the page
          rather than something that appears after hydration. */}
      {enrichment.bio?.summary && (
        <section className="mb-10 max-w-3xl">
          <h2
            className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2"
            style={{ fontFamily: "'DM Mono', monospace" }}
          >
            About {attraction.name}
          </h2>
          <p className="text-sm leading-6 text-foreground/80">
            {enrichment.bio.summary}
          </p>
        </section>
      )}

      {/* TEA-19/21/23/24: streaming links. isLoading is false because the
          server already resolved them - the skeleton state never renders here.
          A follow control belongs beside these once followed artists exist;
          JamSpot has authentication but no saved-entity store yet, so there is
          nothing to follow into. */}
      <section className="mb-10">
        <h2
          className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-3"
          style={{ fontFamily: "'DM Mono', monospace" }}
        >
          Listen
        </h2>
        <StreamingServiceLinks
          artistName={attraction.name}
          spotify={{ isLoading: false, url: enrichment.spotify?.url ?? null }}
          appleMusic={{
            isLoading: false,
            url: enrichment.appleMusic?.url ?? null,
          }}
        />
      </section>

      <h2
        className="text-sm font-bold uppercase tracking-wide text-muted-foreground mb-4"
        style={{ fontFamily: "'DM Mono', monospace" }}
      >
        Upcoming dates
      </h2>

      <DiscoveryEventGrid
        concerts={events.concerts}
        attribution={{
          surface: DISCOVERY_SURFACES.artist,
          path,
          entitySlug: canonicalSlug,
          entityId: attraction.id,
        }}
        emptyMessage={
          events.unavailable
            ? `We can't load ${attraction.name}'s dates right now. Please try again shortly.`
            : `No upcoming ${attraction.name} dates are listed right now. Check back soon.`
        }
      />

      {cityLinks.length > 0 && (
        <section className="mt-12 border-t border-border pt-8">
          <h2
            className="text-sm font-bold uppercase tracking-wide text-muted-foreground mb-4"
            style={{ fontFamily: "'DM Mono', monospace" }}
          >
            Cities on this tour
          </h2>
          <ul className="flex flex-wrap gap-2">
            {cityLinks.map((city) => (
              <li key={city.slug}>
                <Link
                  href={cityPath(city)}
                  className="inline-block text-xs px-4 py-1.5 rounded-full border bg-muted border-border text-muted-foreground hover:border-primary/40 hover:text-foreground transition-all font-medium"
                  style={{ fontFamily: "'DM Mono', monospace" }}
                >
                  {city.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </DiscoveryLayout>
  );
}
