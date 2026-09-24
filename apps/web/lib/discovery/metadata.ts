import type { Metadata } from "next";

import type { NormalizedConcert } from "@/lib/ticketmaster";
import { absoluteUrl, SITE_NAME } from "@/lib/discovery/site";
import { MIN_INDEXABLE_EVENTS, type DiscoveryEvents } from "@/lib/discovery/events";

/**
 * Metadata and indexing decisions for the discovery pages (TEA-67).
 *
 * Every discovery page's title, description, canonical, Open Graph block, and
 * robots directive is produced here, from values already validated by the
 * route. Nothing is generated from a raw path segment, so a page cannot
 * describe itself as being about something we failed to resolve.
 */

/**
 * Should this page be indexed?
 *
 * A discovery page earns indexing by answering the question its URL asks. With
 * no upcoming events it answers nothing - it is the same empty shell as every
 * other eventless city, which is exactly the thin, duplicative content the
 * acceptance criteria rule out. An upstream outage counts as not-indexable for
 * the same reason, and additionally because the emptiness isn't even true.
 *
 * `follow` stays on throughout: a crawler should still walk the links out of a
 * quiet page to the city and genre pages that do have shows.
 */
export function isIndexable(events: DiscoveryEvents): boolean {
  return !events.unavailable && events.concerts.length >= MIN_INDEXABLE_EVENTS;
}

/** The robots directive for a page, given whether it earned indexing. */
export function robotsFor(indexable: boolean): Metadata["robots"] {
  return indexable
    ? { index: true, follow: true }
    : { index: false, follow: true };
}

export type DiscoveryMetadataInput = {
  title: string;
  description: string;
  /** Site-relative canonical path, e.g. "/concerts/san-diego/indie". */
  path: string;
  indexable: boolean;
  /** Absolute image URL for Open Graph, when the page has a real one. */
  imageUrl?: string | null;
};

/**
 * Assemble one discovery page's metadata.
 *
 * The canonical is always the path the *entity* resolves to, never the
 * requested URL, so equivalent spellings collapse onto one indexed address.
 * Open Graph `url` is pinned to the same value for the same reason.
 */
export function buildDiscoveryMetadata({
  title,
  description,
  path,
  indexable,
  imageUrl,
}: DiscoveryMetadataInput): Metadata {
  const url = absoluteUrl(path);

  return {
    /**
     * `absolute` opts out of the root layout's title template. These titles
     * already end in "| JamSpot"; letting the template apply as well produced
     * "... | JamSpot | JamSpot".
     */
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    robots: robotsFor(indexable),
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title,
      description,
      url,
      ...(imageUrl ? { images: [{ url: imageUrl }] } : {}),
    },
    twitter: {
      card: imageUrl ? "summary_large_image" : "summary",
      title,
      description,
      ...(imageUrl ? { images: [imageUrl] } : {}),
    },
  };
}

/** Page title, suffixed the same way across every discovery page. */
export function discoveryTitle(subject: string): string {
  return `${subject} | ${SITE_NAME}`;
}

/** The first event image with a URL, for Open Graph. */
export function leadImage(concerts: readonly NormalizedConcert[]): string | null {
  return concerts.find((concert) => concert.imageUrl)?.imageUrl ?? null;
}

/**
 * The window the listed events cover, as a sentence.
 *
 * Written from the events actually on the page - real dates, not filler. A
 * page with no dated events gets nothing rather than a hedge.
 */
export function describeDateRange(
  concerts: readonly NormalizedConcert[]
): string | null {
  const dates = concerts
    .map((concert) => concert.date)
    .filter((date): date is string => Boolean(date))
    .sort();

  if (dates.length === 0) return null;

  const first = formatLongDate(dates[0]);
  const last = formatLongDate(dates[dates.length - 1]);

  if (!first || !last) return null;
  if (first === last) return `All on ${first}.`;

  return `Dates from ${first} through ${last}.`;
}

/** "2026-09-16" -> "September 16, 2026". Null if it isn't a usable date. */
export function formatLongDate(date: string | null | undefined): string | null {
  if (!date) return null;

  // Parsed as UTC rather than local: Ticketmaster's localDate is a calendar
  // day, and `new Date("2026-09-16")` already means UTC midnight, so the
  // formatter has to read it back in UTC or the day slips west of Greenwich.
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}
