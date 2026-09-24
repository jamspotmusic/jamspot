"use client";

import Image from "next/image";
import { MapPin, Ticket } from "lucide-react";

import type { NormalizedConcert } from "@/lib/ticketmaster";

/**
 * JamSpot's concert card, and the normalized-concert-to-card mapping it reads.
 *
 * Lifted out of app/page.tsx unchanged when the discovery pages landed
 * (TEA-67) so the search results and the city/genre/artist/venue pages render
 * the same card from the same data, rather than growing a second, drifting
 * copy for SEO. app/page.tsx re-exports everything here, so its own importers
 * (and its tests) are unaffected.
 */

const FALLBACK_IMAGE = "https://picsum.photos/400/250?random=1";

/** Shape the UI renders. Derived from the Ticketmaster API's normalized concert data. */
export type CardEvent = {
  id: string;
  artist: string;
  venue: string;
  city: string;
  state: string;
  date: string;
  time: string;
  genre: string;
  priceRange: string | null;
  image: string;
  ticketUrl: string | null;
};

export function formatPriceRange(
  priceRange: NormalizedConcert["priceRange"],
): string | null {
  if (!priceRange) return null;
  const { min, max, currency } = priceRange;
  const symbol = currency === "USD" ? "$" : `${currency} `;
  if (min === max) return `${symbol}${min}`;
  return `${symbol}${min} - ${symbol}${max}`;
}

export function formatDate(date: string | null | undefined): string {
  if (!date) return "Date TBA";

  return new Intl.DateTimeFormat("en-US", {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(date));
}

export function formatTime(time: string | null | undefined): string {
  if (!time) return "Time TBA";

  const [hours, minutes] = time.split(":").map(Number);

  const date = new Date();
  date.setHours(hours,minutes);

  return new Intl.DateTimeFormat("en-US", {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date)
}

export function toCardEvent(concert: NormalizedConcert): CardEvent {
  return {
    id: concert.id,
    artist: concert.artist ?? concert.name,
    venue: concert.venue ?? "Venue TBA",
    city: concert.city ?? "",
    state: concert.state ?? "",
    date: formatDate(concert.date),
    time: formatTime(concert.time),
    genre: concert.genre ?? "Other",
    priceRange: formatPriceRange(concert.priceRange),
    image: concert.imageUrl ?? FALLBACK_IMAGE,
    ticketUrl: concert.ticketUrl,
  };
}

export function EventCard({
  event,
  onOpen,
  onTicketClick,
}: {
  event: CardEvent;
  onOpen: (event: CardEvent) => void;
  onTicketClick: (event: CardEvent) => void;
}) {
  return (
    <li
      id={`event-${event.id}`}
      onClick={() => onOpen(event)}
      className="group relative overflow-hidden rounded-xl bg-card border border-border hover:border-primary/30 transition-all hover:-translate-y-0.5 duration-200 cursor-pointer"
    >
      {/* Image */}
      <div className="relative h-44 overflow-hidden bg-muted">
        <Image
          src={event.image}
          alt={`${event.artist} live`}
          fill
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          className="object-cover opacity-70 group-hover:opacity-85 group-hover:scale-105 transition-all duration-500"
        />

        <div className="absolute inset-0 bg-gradient-to-t from-card via-card/30 to-transparent" />

        {/* Genre badge */}
        <div className="absolute top-3 left-3">
          <span
            className="text-[10px] font-medium px-2 py-0.5 rounded bg-black/60 border border-white/10 text-white/80 backdrop-blur-sm"
            style={{ fontFamily: "'DM Mono', monospace" }}
          >
            {event.genre}
          </span>
        </div>

        {/* Date overlay */}
        <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between">
          <div>
            <p
              className="text-[10px] text-primary/80 font-medium"
              style={{ fontFamily: "'DM Mono', monospace" }}
            >
              {event.date}
            </p>
            <p
              className="text-xs text-white/60"
              style={{ fontFamily: "'DM Mono', monospace" }}
            >
              {event.time}
            </p>
          </div>
        </div>
      </div>

      {/* Card body */}
      <div className="p-4">
        <h3
          className="text-base font-black text-foreground leading-tight mb-1 group-hover:text-primary transition-colors"
          style={{
            fontFamily: "'Unbounded', sans-serif",
            fontSize: "0.875rem",
          }}
        >
          {event.artist}
        </h3>
        <p className="text-sm text-muted-forground flex items-center gap-1 mb-4">
          <MapPin size={11} className="shrink-0" />
          {event.venue} · {event.city}, {event.state}
        </p>

        <div className="flex items-center justify-between">
          <span
            className="text-foreground font-semibold text-sm"
            style={{ fontFamily: "'DM Mono', monospace" }}
          >
            {event.priceRange}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTicketClick(event);
            }}
            disabled={!event.ticketUrl}
            className="
                flex items-center gap-1.5 text-xs bg-primary/10 hover:bg-primary/20 border border-primary/20 hover:border-primary/40 
                text-primary font-medium px-3 py-1.5 rounded-lg transition-all cursor-pointer 
                disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-primary/10 disabled:hover:border-primary/20"
          >
            <Ticket size={12} />
            {event.ticketUrl ? "Get Tickets" : "Unavailable"}
          </button>
        </div>
      </div>
    </li>
  );
}

export function EventCardSkeleton() {
  return (
    <li className="overflow-hidden rounded-xl bg-card border border-border">
      {/* Image skeleton */}
      <div className="h-44 bg-muted animate-pulse" />

      {/* Card body skeleton */}
      <div className="p-4 space-y-4">
        {/* Artist */}
        <div className="h-4 w-3/4 rounded bg-muted animate-pulse" />

        {/* Venue */}
        <div className="h-3 w-full rounded bg-muted animate-pulse" />
        <div className="h-3 w-2/3 rounded bg-muted animate-pulse" />

        {/* Bottom row */}
        <div className="flex items-center justify-between pt-2">
          <div className="h-4 w-20 rounded bg-muted animate-pulse" />
          <div className="h-8 w-28 rounded-lg bg-muted animate-pulse" />
        </div>
      </div>
    </li>
  )
}
