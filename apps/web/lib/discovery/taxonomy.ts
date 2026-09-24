import { toSlug } from "@/lib/discovery/slug";

/**
 * The registries that decide which discovery URLs exist at all (TEA-67).
 *
 * A discovery route never turns an arbitrary path segment into a Ticketmaster
 * search. `/concerts/<anything>` would otherwise be an open proxy onto the
 * Discovery API: unbounded requests against our rate limit, and an unbounded
 * set of thin, near-duplicate pages for crawlers to find. Instead a slug has
 * to resolve against one of the lists below, and anything else is a 404.
 *
 * These are also what make a canonical URL deterministic. The canonical path
 * for a page is built from the *registry entry*, not from whatever the request
 * happened to spell, so `/concerts/SAN-DIEGO` and `/concerts/san--diego` both
 * point one canonical at `/concerts/san-diego`.
 */

/** A city JamSpot publishes a discovery page for. */
export type DiscoveryCity = {
  /** URL segment. Unique across the registry - asserted in the unit tests. */
  slug: string;
  /** Display name, and the `city` Ticketmaster is asked for. */
  name: string;
  /** Two-letter state code, pinned so "Portland" can't mean two places. */
  stateCode: string;
  /** Written out for prose - "San Diego, California". */
  stateName: string;
};

/**
 * US markets with enough steady live-music volume that a city page is worth
 * indexing. Curated rather than generated: a city with three shows a month
 * produces exactly the thin page the indexing rules below are there to avoid.
 *
 * Where a city name is ambiguous, the slug carries the state ("portland-or").
 * That is a URL decision, not a display one - `name` stays "Portland" because
 * that is what Ticketmaster matches on.
 */
export const DISCOVERY_CITIES: readonly DiscoveryCity[] = [
  { slug: "atlanta", name: "Atlanta", stateCode: "GA", stateName: "Georgia" },
  { slug: "austin", name: "Austin", stateCode: "TX", stateName: "Texas" },
  { slug: "baltimore", name: "Baltimore", stateCode: "MD", stateName: "Maryland" },
  { slug: "boston", name: "Boston", stateCode: "MA", stateName: "Massachusetts" },
  { slug: "charlotte", name: "Charlotte", stateCode: "NC", stateName: "North Carolina" },
  { slug: "chicago", name: "Chicago", stateCode: "IL", stateName: "Illinois" },
  { slug: "cincinnati", name: "Cincinnati", stateCode: "OH", stateName: "Ohio" },
  { slug: "cleveland", name: "Cleveland", stateCode: "OH", stateName: "Ohio" },
  { slug: "columbus", name: "Columbus", stateCode: "OH", stateName: "Ohio" },
  { slug: "dallas", name: "Dallas", stateCode: "TX", stateName: "Texas" },
  { slug: "denver", name: "Denver", stateCode: "CO", stateName: "Colorado" },
  { slug: "detroit", name: "Detroit", stateCode: "MI", stateName: "Michigan" },
  { slug: "houston", name: "Houston", stateCode: "TX", stateName: "Texas" },
  { slug: "indianapolis", name: "Indianapolis", stateCode: "IN", stateName: "Indiana" },
  { slug: "kansas-city", name: "Kansas City", stateCode: "MO", stateName: "Missouri" },
  { slug: "las-vegas", name: "Las Vegas", stateCode: "NV", stateName: "Nevada" },
  { slug: "los-angeles", name: "Los Angeles", stateCode: "CA", stateName: "California" },
  { slug: "louisville", name: "Louisville", stateCode: "KY", stateName: "Kentucky" },
  { slug: "memphis", name: "Memphis", stateCode: "TN", stateName: "Tennessee" },
  { slug: "miami", name: "Miami", stateCode: "FL", stateName: "Florida" },
  { slug: "milwaukee", name: "Milwaukee", stateCode: "WI", stateName: "Wisconsin" },
  { slug: "minneapolis", name: "Minneapolis", stateCode: "MN", stateName: "Minnesota" },
  { slug: "nashville", name: "Nashville", stateCode: "TN", stateName: "Tennessee" },
  { slug: "new-orleans", name: "New Orleans", stateCode: "LA", stateName: "Louisiana" },
  { slug: "new-york", name: "New York", stateCode: "NY", stateName: "New York" },
  { slug: "oakland", name: "Oakland", stateCode: "CA", stateName: "California" },
  { slug: "oklahoma-city", name: "Oklahoma City", stateCode: "OK", stateName: "Oklahoma" },
  { slug: "orlando", name: "Orlando", stateCode: "FL", stateName: "Florida" },
  { slug: "philadelphia", name: "Philadelphia", stateCode: "PA", stateName: "Pennsylvania" },
  { slug: "phoenix", name: "Phoenix", stateCode: "AZ", stateName: "Arizona" },
  { slug: "pittsburgh", name: "Pittsburgh", stateCode: "PA", stateName: "Pennsylvania" },
  { slug: "portland-or", name: "Portland", stateCode: "OR", stateName: "Oregon" },
  { slug: "raleigh", name: "Raleigh", stateCode: "NC", stateName: "North Carolina" },
  { slug: "sacramento", name: "Sacramento", stateCode: "CA", stateName: "California" },
  { slug: "salt-lake-city", name: "Salt Lake City", stateCode: "UT", stateName: "Utah" },
  { slug: "san-antonio", name: "San Antonio", stateCode: "TX", stateName: "Texas" },
  { slug: "san-diego", name: "San Diego", stateCode: "CA", stateName: "California" },
  { slug: "san-francisco", name: "San Francisco", stateCode: "CA", stateName: "California" },
  { slug: "san-jose", name: "San Jose", stateCode: "CA", stateName: "California" },
  { slug: "seattle", name: "Seattle", stateCode: "WA", stateName: "Washington" },
  { slug: "st-louis", name: "St. Louis", stateCode: "MO", stateName: "Missouri" },
  { slug: "tampa", name: "Tampa", stateCode: "FL", stateName: "Florida" },
  { slug: "washington-dc", name: "Washington", stateCode: "DC", stateName: "District of Columbia" },
];

/** A genre JamSpot publishes city/genre pages for. */
export type DiscoveryGenre = {
  /** URL segment. Canonical - one slug per genre, no aliases. */
  slug: string;
  /** Display name, used in headings and titles. */
  label: string;
  /**
   * The canonical internal genre id: the exact string handed to Ticketmaster
   * as `classificationName`. Kept separate from `slug` and `label` so the URL
   * and the heading can be tuned without silently changing which events the
   * page is about.
   */
  classificationName: string;
};

/**
 * Genres with a URL of their own.
 *
 * `classificationName` values are ones Ticketmaster's Music segment actually
 * matches - the same constraint the concert-query Edge Function works under
 * (see TICKETMASTER_MUSIC_GENRES in supabase/functions/concert-query), because
 * an unrecognised classification returns zero events with no error, which
 * would look like a city with no shows rather than like a bad URL.
 *
 * "Indie" is listed alongside "Alternative" on purpose: Ticketmaster matches
 * it against its indie sub-genres, so the two produce genuinely different
 * result sets rather than two URLs for one page.
 */
export const DISCOVERY_GENRES: readonly DiscoveryGenre[] = [
  { slug: "alternative", label: "Alternative", classificationName: "Alternative" },
  { slug: "blues", label: "Blues", classificationName: "Blues" },
  { slug: "classical", label: "Classical", classificationName: "Classical" },
  { slug: "country", label: "Country", classificationName: "Country" },
  { slug: "electronic", label: "Electronic", classificationName: "Dance/Electronic" },
  { slug: "folk", label: "Folk", classificationName: "Folk" },
  { slug: "hip-hop", label: "Hip-Hop", classificationName: "Hip-Hop/Rap" },
  { slug: "indie", label: "Indie", classificationName: "Indie" },
  { slug: "jazz", label: "Jazz", classificationName: "Jazz" },
  { slug: "latin", label: "Latin", classificationName: "Latin" },
  { slug: "metal", label: "Metal", classificationName: "Metal" },
  { slug: "pop", label: "Pop", classificationName: "Pop" },
  { slug: "punk", label: "Punk", classificationName: "Punk" },
  { slug: "r-and-b", label: "R&B", classificationName: "R&B" },
  { slug: "reggae", label: "Reggae", classificationName: "Reggae" },
  { slug: "rock", label: "Rock", classificationName: "Rock" },
  { slug: "world", label: "World", classificationName: "World" },
];

const CITIES_BY_SLUG = new Map(
  DISCOVERY_CITIES.map((city) => [city.slug, city] as const)
);

const GENRES_BY_SLUG = new Map(
  DISCOVERY_GENRES.map((genre) => [genre.slug, genre] as const)
);

/**
 * Resolve a city slug, or null when it isn't one we publish.
 *
 * Takes the already-canonicalized slug (see normalizeSlugParam) - matching is
 * exact, so the routes stay responsible for deciding whether a non-canonical
 * spelling redirects or 404s, rather than having that swallowed here.
 */
export function findCityBySlug(slug: string | null): DiscoveryCity | null {
  if (!slug) return null;
  return CITIES_BY_SLUG.get(slug) ?? null;
}

/** Resolve a genre slug, or null when it isn't one we publish. */
export function findGenreBySlug(slug: string | null): DiscoveryGenre | null {
  if (!slug) return null;
  return GENRES_BY_SLUG.get(slug) ?? null;
}

/**
 * Does a Ticketmaster classification fall under `genre`'s page?
 *
 * Ticketmaster's `classificationName` is a token match, not an equality test:
 * asking for "Indie" returns events classified "Indie Rock", and asking for
 * "Rock" returns "Alternative Rock" too. So the reverse direction has to model
 * the same relationship, or a city page would decline to link to the very
 * genre page its own events appear on.
 *
 * Both sides are compared as slugs, and the match is anchored to hyphen
 * boundaries so only whole tokens count - "pop" must not match "hip-hop-rap".
 */
function classificationMatchesGenre(
  classificationSlug: string,
  genre: DiscoveryGenre
): boolean {
  const target = toSlug(genre.classificationName);

  return (
    classificationSlug === target ||
    classificationSlug.startsWith(`${target}-`) ||
    classificationSlug.endsWith(`-${target}`) ||
    classificationSlug.includes(`-${target}-`)
  );
}

/**
 * Every genre page a Ticketmaster classification belongs on.
 *
 * Plural because one classification genuinely belongs on several: an
 * "Alternative Rock" show is returned by both `classificationName=Alternative`
 * and `classificationName=Rock`, so it appears on both pages and should
 * advertise both.
 *
 * Matching goes through `classificationName` rather than through a display
 * string: an event classified "Hip-Hop/Rap" belongs on
 * `/concerts/<city>/hip-hop`, which un-slugging "Hip-Hop/Rap" would never
 * produce. Classifications we publish no page for yield an empty list, and are
 * simply not used to advertise anything.
 */
export function genresForClassification(
  classification: string | null | undefined
): DiscoveryGenre[] {
  if (!classification) return [];

  const slug = toSlug(classification);
  if (!slug) return [];

  return DISCOVERY_GENRES.filter((genre) =>
    classificationMatchesGenre(slug, genre)
  );
}

/**
 * The single best genre page for a classification, or null.
 *
 * "Best" is the most specific one - the longest classification that matches -
 * so "Alternative Rock" reads as Alternative rather than as Rock. Callers that
 * want every page the event belongs on use genresForClassification instead.
 */
export function findGenreByClassification(
  classification: string | null | undefined
): DiscoveryGenre | null {
  const matches = genresForClassification(classification);
  if (matches.length === 0) return null;

  return [...matches].sort(
    (a, b) =>
      b.classificationName.length - a.classificationName.length ||
      (a.slug < b.slug ? -1 : 1)
  )[0];
}
