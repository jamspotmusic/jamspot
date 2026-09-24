import { cache } from "react";

import {
  searchAttractions,
  searchVenues,
  type NormalizedAttraction,
  type NormalizedVenue,
} from "@/lib/ticketmaster";
import { toSlug } from "@/lib/discovery/slug";

/**
 * Turning an artist or venue slug back into a Ticketmaster entity (TEA-67).
 *
 * Cities and genres come from a registry we control. Artists and venues can't:
 * there are hundreds of thousands of them and the set changes daily. So the
 * slug is resolved against Ticketmaster - but on strict terms, because the
 * alternative is that any path segment becomes a Ticketmaster search and every
 * crawl of a 404 costs us a request:
 *
 *   1. The slug is searched as a keyword.
 *   2. A candidate counts only if its *name slugifies back to exactly the
 *      requested slug*. A near match is not a match; "the-national" must not
 *      resolve to "The Petty Hearts - The National Tom Petty Tribute Show".
 *   3. Identity is then the Ticketmaster id, never the name. Events are
 *      fetched by `attractionId` / `venueId`, so two acts that share a name
 *      can never bleed into one page.
 *
 * No match means no stable identity, which means no page - the route returns
 * 404 rather than publishing an indexable page about a guess.
 *
 * Rule 2 has one carefully bounded relaxation, because Ticketmaster does not
 * always spell a name the same way twice. The venue embedded in an event can
 * read "The Rave/Eagles Club" while the venues endpoint calls the same room
 * "Eagles Club/The Rave/Eagles Ballroom" - so a slug built from the first
 * would 404 against the second, for a venue that plainly exists. See
 * `pickEntityMatch` for the fallback and the guards on it.
 */

/** How many candidates to consider. One request, bounded. */
const CANDIDATE_LIMIT = 20;

/**
 * Words a candidate's name may have that the slug does not, before it stops
 * being the same entity under a different spelling and starts being a
 * different entity that merely contains those words.
 */
const MAX_EXTRA_WORDS = 1;

/** A resolved artist: one Ticketmaster attraction, and its canonical slug. */
export type ResolvedArtist = {
  attraction: NormalizedAttraction;
  /** The slug this attraction's page lives at. */
  canonicalSlug: string;
};

/** A resolved venue: one Ticketmaster venue, and its canonical slug. */
export type ResolvedVenue = {
  venue: NormalizedVenue;
  canonicalSlug: string;
};

/**
 * The text to search Ticketmaster for, given a slug.
 *
 * This is emphatically not "un-slugging": hyphens become spaces and that is
 * all. The result is a *search term*, and it is only ever used to produce
 * candidates that are then matched against their own real names by
 * `pickEntityMatch`, so a slug that spaces out wrongly ("r-and-b" -> "r and
 * b") costs a miss, never a wrong entity.
 */
export function slugToKeyword(slug: string): string {
  return slug.replace(/-/g, " ").trim();
}

/**
 * Pick the one entity `slug` names, or null.
 *
 * Exact first: candidates whose name slugifies back to exactly `slug`. When
 * several do - a real possibility for venues, where "House of Blues" names a
 * dozen rooms - the lowest Ticketmaster id wins. That tie-break exists to be
 * *deterministic*, not to be clever: the same candidate set always yields the
 * same entity, so a page's canonical never flip-flops between two venues.
 *
 * Failing that, one narrow fallback for Ticketmaster's inconsistent naming: a
 * candidate matches if every word of the slug appears in its name *and* the
 * name adds at most one word of its own. Four guards keep this from merging
 * distinct entities:
 *
 *   - the slug must have at least two words, so "rush" cannot match "Rush
 *     Tribute Project";
 *   - the name may add at most MAX_EXTRA_WORDS. This is the guard that does
 *     the real work. "the-rave-eagles-club" against "Eagles Club/The Rave/
 *     Eagles Ballroom" adds one word and matches; "the-national" against "The
 *     Petty Hearts - The National Tom Petty Tribute Show" adds five and does
 *     not, which is exactly the confusion the acceptance criteria forbid;
 *   - the match must be *unique* among the candidates, so "house-of-blues"
 *     resolves to nothing rather than to whichever room sorted first;
 *   - identity still comes from the matched entity's id, and the page's
 *     canonical still comes from that entity's own name - so an alternate
 *     spelling renders, but only the entity's canonical URL is indexed.
 */
export function pickEntityMatch<T extends { id: string; name: string }>(
  candidates: readonly T[],
  slug: string
): T | null {
  const exact = candidates.filter(
    (candidate) => toSlug(candidate.name) === slug
  );
  if (exact.length > 0) return lowestId(exact);

  const words = slug.split("-").filter(Boolean);
  if (words.length < 2) return null;

  // Ambiguity is judged first, over every candidate containing the slug's
  // words. Applying the extra-word limit before this would decide ambiguity
  // by accident: "house-of-blues" matches both "House of Blues Chicago" and
  // "House of Blues San Diego", but only Chicago survives a word limit -
  // leaving one "unique" match that is unique only because that city's name
  // is shorter.
  const containing = candidates
    .map((candidate) => ({ candidate, words: nameWords(candidate.name) }))
    .filter(({ words: names }) => words.every((word) => names.has(word)));
  if (containing.length !== 1) return null;

  const [{ candidate, words: names }] = containing;
  return names.size <= words.length + MAX_EXTRA_WORDS ? candidate : null;
}

/** The distinct words in a name, as slug tokens. */
function nameWords(name: string): Set<string> {
  return new Set(toSlug(name).split("-").filter(Boolean));
}

function lowestId<T extends { id: string }>(candidates: readonly T[]): T {
  return [...candidates].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  )[0];
}

/**
 * Resolve an artist slug to one Ticketmaster attraction, or null when no such
 * attraction exists.
 *
 * Cached per render so the page body and `generateMetadata` resolve the artist
 * once between them rather than searching Ticketmaster twice.
 *
 * A Ticketmaster failure is deliberately *not* caught here, and the asymmetry
 * with lib/discovery/events.ts is the point. A city page can render honestly
 * during an outage because the registry already tells it which city it is; it
 * shows an empty state and goes noindex. This page cannot - without the
 * lookup there is no artist to write a heading about. The remaining choice is
 * between answering 404 and answering 5xx, and 404 is the wrong one: it tells
 * a crawler the page does not exist, when all we actually know is that we
 * could not check. Letting the error through yields a 5xx, which is the
 * transient signal, and the page is retried rather than dropped.
 */
export const resolveArtistSlug = cache(
  async (slug: string): Promise<ResolvedArtist | null> => {
    const candidates = await searchAttractions({
      keyword: slugToKeyword(slug),
      countryCode: "US",
      size: CANDIDATE_LIMIT,
    });

    const attraction = pickEntityMatch(candidates, slug);
    if (!attraction) return null;

    return { attraction, canonicalSlug: toSlug(attraction.name) };
  }
);

/**
 * Resolve a venue slug to one Ticketmaster venue, or null when no such venue
 * exists. Same outage reasoning as resolveArtistSlug.
 */
export const resolveVenueSlug = cache(
  async (slug: string): Promise<ResolvedVenue | null> => {
    const candidates = await searchVenues({
      keyword: slugToKeyword(slug),
      countryCode: "US",
      size: CANDIDATE_LIMIT,
    });

    const venue = pickEntityMatch(candidates, slug);
    if (!venue) return null;

    return { venue, canonicalSlug: toSlug(venue.name) };
  }
);
