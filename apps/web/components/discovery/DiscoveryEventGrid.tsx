"use client";

import { useEffect, useState } from "react";
import { Music2 } from "lucide-react";

import type { NormalizedConcert } from "@/lib/ticketmaster";
import { EventCard, toCardEvent, type CardEvent } from "@/components/EventCard";
import ConcertModal, { type ConcertModalEvent } from "@/components/ConcertModal";
import {
  track,
  type DiscoveryAttribution,
} from "@/lib/analytics/discovery-attribution";

/**
 * The event grid every discovery page renders (TEA-67).
 *
 * A client component, but one whose entire first paint comes from props: the
 * server route has already fetched and normalized the concerts, so this
 * component never fetches anything to show its list. That is what puts the
 * real listings in the initial HTML - a crawler that executes no JavaScript
 * still sees every card, heading, and link - while leaving the interactive
 * parts (opening the detail modal, the ticket click) working exactly as they
 * do on the search results page.
 *
 * The concert detail experience is the existing one: the same EventCard, the
 * same ConcertModal, the same ticket CTA pointing at the same Ticketmaster
 * URL. Discovery pages add attribution around that flow; they do not fork it.
 */

export default function DiscoveryEventGrid({
  concerts,
  attribution,
  emptyMessage,
}: {
  concerts: NormalizedConcert[];
  attribution: DiscoveryAttribution;
  /** Shown in place of the grid when there are no events. */
  emptyMessage: string;
}) {
  const [selected, setSelected] = useState<ConcertModalEvent | null>(null);

  /**
   * One page-view event per discovery page, carrying the surface and the
   * result count - so TEA-54 can tell a page that converted nothing from a
   * page that had nothing to convert.
   *
   * Depending on the `attribution` object itself is deliberate and safe here:
   * it arrives as a prop from the Server Component, so its identity changes
   * only when a new page is rendered - which is exactly when a new view should
   * be reported. Opening the detail modal re-renders this component through
   * its own state, which preserves the props object, so it does not re-fire.
   */
  useEffect(() => {
    track({
      type: "discovery_page_view",
      attribution,
      resultCount: concerts.length,
    });
  }, [attribution, concerts.length]);

  if (concerts.length === 0) {
    return (
      <div className="text-center py-24">
        <Music2
          size={40}
          className="text-muted-foreground mx-auto mb-4 opacity-40"
        />
        <p className="text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  const handleOpen = (event: CardEvent) => {
    const concert = concerts.find((candidate) => candidate.id === event.id);

    setSelected({ ...event, subGenre: concert?.subGenre ?? "" });
    track({
      type: "discovery_concert_opened",
      attribution,
      concertId: event.id,
    });
  };

  const handleTicketClick = (event: CardEvent) => {
    if (!event.ticketUrl) return;

    // Recorded before navigating, and recorded on our side only: the URL
    // opened is `event.ticketUrl` unchanged. No tracking parameter is appended
    // to it - see lib/analytics/discovery-attribution.ts.
    track({
      type: "ticket_cta_clicked",
      attribution,
      concertId: event.id,
      placement: "card",
    });

    window.open(event.ticketUrl, "_blank", "noreferrer");
  };

  return (
    <>
      <ul className="grid w-full grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {concerts.map((concert) => (
          <EventCard
            key={concert.id}
            event={toCardEvent(concert)}
            onOpen={handleOpen}
            onTicketClick={handleTicketClick}
          />
        ))}
      </ul>

      {selected && (
        <ConcertModal
          key={selected.id}
          event={selected}
          onClose={() => setSelected(null)}
          onTicketClick={(event) =>
            track({
              type: "ticket_cta_clicked",
              attribution,
              concertId: event.id,
              placement: "detail",
            })
          }
        />
      )}
    </>
  );
}
