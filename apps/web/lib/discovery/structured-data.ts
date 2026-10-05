import type { NormalizedConcert } from "@/lib/ticketmaster";
import { absoluteUrl } from "@/lib/discovery/site";

/**
 * schema.org Event markup for the discovery pages (TEA-67).
 *
 * The governing rule is that every emitted field is something Ticketmaster
 * actually told us. Nothing here is defaulted, inferred, or filled in to
 * satisfy a rich-result checklist:
 *
 *   - no `eventStatus` or `eventAttendanceMode` - we are not told either;
 *   - no `offers.availability` - a price range is not a statement about
 *     whether tickets are left;
 *   - no street address on the venue - we hold a city and a state, so that is
 *     all the Place carries;
 *   - no `performer` unless the event names an attraction;
 *   - no `startDate` unless the event has a date.
 *
 * An event missing the bare minimum (a name and a start date) is left out of
 * the graph entirely rather than published half-described.
 */

/** A JSON-LD node. Loosely typed on purpose - fields are omitted, not nulled. */
type JsonLdNode = Record<string, unknown>;

/**
 * Build the Event node for one concert, or null when it lacks the minimum
 * schema.org requires (`name` and `startDate`).
 *
 * `pagePath` is the discovery page the event is listed on; the event's `url`
 * points at that page's anchor for it, which is a JamSpot URL that genuinely
 * renders the event. The Ticketmaster link stays where it belongs - on the
 * offer, and on the page's ticket CTA.
 */
export function buildEventJsonLd(
  concert: NormalizedConcert,
  pagePath: string
): JsonLdNode | null {
  const startDate = toIsoStart(concert.date, concert.time);
  if (!concert.name || !startDate) return null;

  const node: JsonLdNode = {
    "@type": "Event",
    name: concert.name,
    startDate,
    url: `${absoluteUrl(pagePath)}#event-${concert.id}`,
  };

  const location = buildLocation(concert);
  if (location) node.location = location;

  if (concert.imageUrl) node.image = concert.imageUrl;

  if (concert.artist) {
    node.performer = { "@type": "MusicGroup", name: concert.artist };
  }

  const offers = buildOffers(concert);
  if (offers) node.offers = offers;

  return node;
}

/**
 * The venue, as far as we know it.
 *
 * Omitted entirely when the event has no venue name: a Place with nothing but
 * a city is not a location, it is a guess.
 */
function buildLocation(concert: NormalizedConcert): JsonLdNode | null {
  if (!concert.venue) return null;

  const place: JsonLdNode = { "@type": "Place", name: concert.venue };

  const address: JsonLdNode = { "@type": "PostalAddress" };
  if (concert.city) address.addressLocality = concert.city;
  if (concert.state) address.addressRegion = concert.state;

  // Only attach an address once there is something in it beyond its type.
  if (Object.keys(address).length > 1) place.address = address;

  return place;
}

/**
 * The published price range, when there is one.
 *
 * `availability` is deliberately absent - Ticketmaster's priceRanges say what
 * tickets cost, not whether any remain.
 */
function buildOffers(concert: NormalizedConcert): JsonLdNode | null {
  if (!concert.priceRange && !concert.ticketUrl) return null;

  const offers: JsonLdNode = { "@type": "AggregateOffer" };

  if (concert.ticketUrl) offers.url = concert.ticketUrl;

  if (concert.priceRange) {
    offers.lowPrice = concert.priceRange.min;
    offers.highPrice = concert.priceRange.max;
    offers.priceCurrency = concert.priceRange.currency;
  }

  // A bare "@type" is not an offer worth emitting.
  return Object.keys(offers).length > 1 ? offers : null;
}

/**
 * Combine Ticketmaster's local date and local time into an ISO 8601 string.
 *
 * No timezone designator is appended. Ticketmaster gives a wall-clock time at
 * the venue with no offset, and inventing "Z" would move every show by hours.
 * A local ISO date-time is valid schema.org and is the honest reading.
 */
export function toIsoStart(
  date: string | null,
  time: string | null
): string | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (!time || !/^\d{2}:\d{2}(:\d{2})?$/.test(time)) return date;

  return `${date}T${time.length === 5 ? `${time}:00` : time}`;
}

/**
 * The whole page's structured data: an ItemList of the events on it.
 *
 * Returns null when nothing on the page qualifies, so an empty page emits no
 * markup at all rather than an empty list.
 */
export function buildEventListJsonLd(
  concerts: readonly NormalizedConcert[],
  pagePath: string
): JsonLdNode | null {
  const events = concerts
    .map((concert) => buildEventJsonLd(concert, pagePath))
    .filter((node): node is JsonLdNode => node !== null);

  if (events.length === 0) return null;

  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: events.map((event, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: event,
    })),
  };
}
