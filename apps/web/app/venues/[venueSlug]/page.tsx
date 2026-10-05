import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import DiscoveryLayout from "@/components/discovery/DiscoveryLayout";
import DiscoveryEventGrid from "@/components/discovery/DiscoveryEventGrid";
import JsonLd from "@/components/discovery/JsonLd";
import { DISCOVERY_SURFACES } from "@/lib/analytics/discovery-attribution";
import { resolveVenueSlug } from "@/lib/discovery/entities";
import { getVenueEvents } from "@/lib/discovery/events";
import {
  buildDiscoveryMetadata,
  describeDateRange,
  discoveryTitle,
  isIndexable,
  leadImage,
} from "@/lib/discovery/metadata";
import { normalizeSlugParam, toSlug } from "@/lib/discovery/slug";
import { buildEventListJsonLd } from "@/lib/discovery/structured-data";
import { cityPath, venuePath } from "@/lib/discovery/site";
import { findCityBySlug } from "@/lib/discovery/taxonomy";

/**
 * /venues/[venueSlug] - one room's upcoming shows (TEA-67).
 *
 * Venue names collide far more than artist names do - "House of Blues" is a
 * dozen different buildings, and Ticketmaster lists a "Belly Up Aspen" and a
 * "Belly Up Tavern" that are nothing to do with each other. So identity here
 * is strictly the Ticketmaster venue id: the slug selects exactly one venue by
 * exact name match, and every event on the page is fetched by that venue's id.
 * Two similarly named rooms can never end up on one page.
 */

export const revalidate = 1800;

/** Nothing is prebuilt - same reasoning as the artist route. */
export function generateStaticParams() {
  return [];
}

type VenuePageProps = { params: Promise<{ venueSlug: string }> };

async function resolveVenue(raw: string) {
  const slug = normalizeSlugParam(raw);
  if (!slug) notFound();

  const resolved = await resolveVenueSlug(slug);
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

/** "Solana Beach, CA" - whichever halves Ticketmaster actually gave us. */
function describeLocation(venue: {
  city: string | null;
  state: string | null;
}): string | null {
  return [venue.city, venue.state].filter(Boolean).join(", ") || null;
}

export async function generateMetadata({
  params,
}: VenuePageProps): Promise<Metadata> {
  const { venueSlug } = await params;
  const { venue, canonicalSlug } = await resolveVenue(venueSlug);
  const events = await getVenueEvents(venue.id);

  const location = describeLocation(venue);

  return buildDiscoveryMetadata({
    title: discoveryTitle(`${venue.name} Concerts & Tickets`),
    description: location
      ? `Upcoming concerts at ${venue.name} in ${location}. Browse the schedule and get tickets through JamSpot.`
      : `Upcoming concerts at ${venue.name}. Browse the schedule and get tickets through JamSpot.`,
    path: venuePath(canonicalSlug),
    indexable: isIndexable(events),
    imageUrl: venue.imageUrl ?? leadImage(events.concerts),
  });
}

export default async function VenuePage({ params }: VenuePageProps) {
  const { venueSlug } = await params;
  const { venue, canonicalSlug } = await resolveVenue(venueSlug);
  const events = await getVenueEvents(venue.id);

  const path = venuePath(canonicalSlug);
  const location = describeLocation(venue);
  const dateRange = describeDateRange(events.concerts);

  // The venue's own city, when JamSpot publishes a page for it.
  const city = findCityBySlug(venue.city ? toSlug(venue.city) : null);

  return (
    <DiscoveryLayout
      breadcrumbs={[
        { label: "JamSpot", href: "/" },
        { label: "Venues", href: "/" },
        ...(city ? [{ label: city.name, href: cityPath(city) }] : []),
        { label: venue.name },
      ]}
    >
      <JsonLd data={buildEventListJsonLd(events.concerts, path)} />

      <header className="mb-8">
        <h1
          className="text-3xl lg:text-4xl font-black tracking-tight"
          style={{ fontFamily: "'Unbounded', sans-serif" }}
        >
          Concerts at {venue.name}
        </h1>
        {location && (
          <p
            className="mt-2 text-sm text-muted-foreground"
            style={{ fontFamily: "'DM Mono', monospace" }}
          >
            {location}
          </p>
        )}
        <p className="mt-3 text-sm text-muted-foreground">
          {events.concerts.length > 0 ? (
            <>
              {events.concerts.length} upcoming{" "}
              {events.concerts.length === 1 ? "show" : "shows"}
              {dateRange ? ` · ${dateRange}` : "."}
            </>
          ) : (
            <>No shows currently on sale through Ticketmaster.</>
          )}
        </p>
        {/* A follow control belongs here once JamSpot has saved/followed
            entities to write to. Authentication exists; the store does not. */}
      </header>

      <DiscoveryEventGrid
        concerts={events.concerts}
        attribution={{
          surface: DISCOVERY_SURFACES.venue,
          path,
          entitySlug: canonicalSlug,
          entityId: venue.id,
        }}
        emptyMessage={
          events.unavailable
            ? `We can't load the ${venue.name} schedule right now. Please try again shortly.`
            : `No upcoming shows listed at ${venue.name} right now. Check back soon.`
        }
      />

      {city && (
        <section className="mt-12 border-t border-border pt-8">
          <Link
            href={cityPath(city)}
            className="text-sm text-primary hover:underline"
          >
            All concerts in {city.name} →
          </Link>
        </section>
      )}
    </DiscoveryLayout>
  );
}
