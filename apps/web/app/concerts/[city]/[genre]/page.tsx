import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import DiscoveryLayout from "@/components/discovery/DiscoveryLayout";
import DiscoveryEventGrid from "@/components/discovery/DiscoveryEventGrid";
import JsonLd from "@/components/discovery/JsonLd";
import { DISCOVERY_SURFACES } from "@/lib/analytics/discovery-attribution";
import { getCityGenreEvents } from "@/lib/discovery/events";
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
  findCityBySlug,
  findGenreBySlug,
  type DiscoveryCity,
  type DiscoveryGenre,
} from "@/lib/discovery/taxonomy";

/**
 * /concerts/[city]/[genre] - one city, one genre (TEA-67).
 *
 * The two URL segments are the *only* inputs to what this page shows. Stored
 * preferences, a saved location, and Luna's interpretation of anything all
 * have no effect here by construction - none of them is read. An indexed page
 * has to show every visitor and every crawler the result set its URL claims,
 * so the explicit criteria in the path are authoritative.
 */

/** See the city route - half an hour, matching the Ticketmaster cache TTL. */
export const revalidate = 1800;

/**
 * Nothing is prebuilt.
 *
 * 43 cities x 17 genres is 731 routes, almost all of which nobody will ever
 * ask for; building them would mean 731 Ticketmaster requests at every deploy
 * to produce mostly-unvisited pages. They render on demand and are cached
 * afterwards, which is the same outcome for anything with real traffic.
 */
export function generateStaticParams() {
  return [];
}

type CityGenrePageProps = {
  params: Promise<{ city: string; genre: string }>;
};

type Resolved = { city: DiscoveryCity; genre: DiscoveryGenre };

/**
 * Resolve both segments, or leave the route.
 *
 * Either segment failing is a 404: an unresolvable city/genre combination is
 * not a page, and must not become an unconstrained Ticketmaster search. A
 * combination that resolves but is spelled non-canonically redirects, so the
 * canonical URL is the only one served - though proxy.ts normalizes spelling
 * before the request gets this far. See the city route for why.
 */
function resolveCityGenre(rawCity: string, rawGenre: string): Resolved {
  const city = findCityBySlug(normalizeSlugParam(rawCity));
  const genre = findGenreBySlug(normalizeSlugParam(rawGenre));

  if (!city || !genre) notFound();
  if (!isCanonicalSlug(rawCity) || !isCanonicalSlug(rawGenre)) {
    redirect(cityGenrePath(city, genre));
  }

  return { city, genre };
}

export async function generateMetadata({
  params,
}: CityGenrePageProps): Promise<Metadata> {
  const { city, genre } = await params;
  const resolved = resolveCityGenre(city, genre);
  const events = await getCityGenreEvents(resolved.city, resolved.genre);

  return buildDiscoveryMetadata({
    title: discoveryTitle(
      `${resolved.genre.label} Concerts in ${resolved.city.name}`
    ),
    description: `Discover upcoming ${resolved.genre.label.toLowerCase()} concerts in ${resolved.city.name}, ${resolved.city.stateName}, and find tickets through JamSpot.`,
    path: cityGenrePath(resolved.city, resolved.genre),
    indexable: isIndexable(events),
    imageUrl: leadImage(events.concerts),
  });
}

export default async function CityGenrePage({ params }: CityGenrePageProps) {
  const { city, genre } = await params;
  const resolved = resolveCityGenre(city, genre);
  const events = await getCityGenreEvents(resolved.city, resolved.genre);

  const path = cityGenrePath(resolved.city, resolved.genre);
  const dateRange = describeDateRange(events.concerts);

  return (
    <DiscoveryLayout
      breadcrumbs={[
        { label: "JamSpot", href: "/" },
        { label: "Concerts", href: "/" },
        { label: resolved.city.name, href: cityPath(resolved.city) },
        { label: resolved.genre.label },
      ]}
    >
      <JsonLd data={buildEventListJsonLd(events.concerts, path)} />

      <header className="mb-8">
        <h1
          className="text-3xl lg:text-4xl font-black tracking-tight"
          style={{ fontFamily: "'Unbounded', sans-serif" }}
        >
          {resolved.genre.label} Concerts in {resolved.city.name}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {events.concerts.length > 0 ? (
            <>
              {events.concerts.length} upcoming{" "}
              {resolved.genre.label.toLowerCase()}{" "}
              {events.concerts.length === 1 ? "show" : "shows"} in{" "}
              {resolved.city.name}, {resolved.city.stateName}
              {dateRange ? ` · ${dateRange}` : "."}
            </>
          ) : (
            <>
              {resolved.genre.label} shows in {resolved.city.name},{" "}
              {resolved.city.stateName}.
            </>
          )}
        </p>
      </header>

      <DiscoveryEventGrid
        concerts={events.concerts}
        attribution={{
          surface: DISCOVERY_SURFACES.cityGenre,
          path,
          citySlug: resolved.city.slug,
          genreSlug: resolved.genre.slug,
        }}
        emptyMessage={
          events.unavailable
            ? `We can't load ${resolved.city.name} shows right now. Please try again shortly.`
            : `No upcoming ${resolved.genre.label.toLowerCase()} shows listed in ${resolved.city.name} right now.`
        }
      />

      <section className="mt-12 border-t border-border pt-8">
        <Link
          href={cityPath(resolved.city)}
          className="text-sm text-primary hover:underline"
        >
          All concerts in {resolved.city.name} →
        </Link>
      </section>
    </DiscoveryLayout>
  );
}
