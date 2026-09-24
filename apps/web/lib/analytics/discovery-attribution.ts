/**
 * Attribution for organic discovery traffic (TEA-67, feeding TEA-54).
 *
 * The journey worth measuring is:
 *
 *   Google -> /concerts/san-diego/indie -> concert detail -> Get Tickets
 *           -> Ticketmaster
 *
 * and the thing that makes it hard is that the last hop leaves our origin. By
 * the time the user is on Ticketmaster we can no longer observe anything, so
 * the surface that started the journey has to be carried forward *in the page*
 * - from the server-rendered discovery route, through the card, through the
 * detail modal, onto the click - and recorded on our side at the moment of the
 * click.
 *
 * Two constraints shape this module:
 *
 *   1. **The outbound URL is not touched.** Attribution is emphatically not
 *      appended to the Ticketmaster link. Affiliate and tracking parameters on
 *      Ticketmaster URLs are out of scope until an affiliate agreement exists,
 *      and the acceptance criteria require the ticket CTA to behave exactly as
 *      it does today. So `href` stays `concert.ticketUrl`, verbatim, and the
 *      attribution is recorded as an event we own.
 *
 *   2. **No analytics provider is chosen here.** TEA-54 owns that decision and
 *      has not landed. Rather than guess at a vendor, this module defines the
 *      event shape and a sink to hand it to; the default sink does nothing.
 *      Wiring TEA-54 up is `setAnalyticsSink(...)` in one place, and none of
 *      the call sites change.
 */

/**
 * Which kind of discovery page a visit originated on.
 *
 * These strings are the contract with TEA-54's reporting, so they are written
 * out literally rather than derived from a route pattern - a refactor of the
 * app directory must not silently rename a dimension that historical data is
 * grouped by.
 */
export const DISCOVERY_SURFACES = {
  city: "seo_city",
  cityGenre: "seo_city_genre",
  artist: "seo_artist",
  venue: "seo_venue",
} as const;

export type DiscoverySurface =
  (typeof DISCOVERY_SURFACES)[keyof typeof DISCOVERY_SURFACES];

/**
 * What a discovery page knows about itself, passed down to the ticket CTA.
 *
 * `entityId` is the Ticketmaster attraction or venue id on artist and venue
 * pages, and absent on city pages, whose identity is fully described by the
 * slug pair.
 */
export type DiscoveryAttribution = {
  surface: DiscoverySurface;
  /** Canonical path of the originating page, e.g. "/concerts/san-diego/indie". */
  path: string;
  /** City slug, on city and city/genre pages. */
  citySlug?: string;
  /** Genre slug, on city/genre pages. */
  genreSlug?: string;
  /** Artist or venue slug, on those pages. */
  entitySlug?: string;
  /** Ticketmaster attraction/venue id backing `entitySlug`. */
  entityId?: string;
};

/** Events this module emits. Discriminated so a sink can switch on `type`. */
export type AnalyticsEvent =
  | {
      type: "discovery_page_view";
      attribution: DiscoveryAttribution;
      /** Events rendered on the page. Zero means a page we also noindex. */
      resultCount: number;
    }
  | {
      type: "discovery_concert_opened";
      attribution: DiscoveryAttribution;
      concertId: string;
    }
  | {
      type: "ticket_cta_clicked";
      /**
       * Absent when the click did not start on a discovery page - the home
       * page's Luna results, for instance. Reporting can then separate organic
       * discovery from in-app search rather than having to assume.
       */
      attribution?: DiscoveryAttribution;
      concertId: string;
      /** Where in the UI the click happened. */
      placement: "card" | "detail";
    };

/** Anything that can receive events. TEA-54 supplies the real one. */
export type AnalyticsSink = (event: AnalyticsEvent) => void;

/**
 * The default sink: drop everything.
 *
 * Deliberately silent rather than a console warning - these fire on ordinary
 * user actions, and a warning per click would be noise in every developer's
 * console for a feature that is simply not wired up yet.
 */
const noopSink: AnalyticsSink = () => {};

let sink: AnalyticsSink = noopSink;

/**
 * Install the analytics sink. TEA-54's integration point.
 *
 * Call once, from a client component near the root.
 */
export function setAnalyticsSink(next: AnalyticsSink | null): void {
  sink = next ?? noopSink;
}

/**
 * Record an event.
 *
 * Never throws: an analytics failure must not take down a ticket click, which
 * is the single most valuable interaction on the site.
 */
export function track(event: AnalyticsEvent): void {
  try {
    sink(event);
  } catch {
    // Swallowed on purpose - see above.
  }
}
