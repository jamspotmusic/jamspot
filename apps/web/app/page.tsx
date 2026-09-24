"use client";

import { useState, useEffect, useMemo } from "react";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MapPin, Ticket, Music2, Calendar, Clock, X } from "lucide-react";

import type { NormalizedConcert } from "@/lib/ticketmaster";
import {
  EventCard,
  EventCardSkeleton,
  formatDate,
  formatPriceRange,
  formatTime,
  toCardEvent,
  type CardEvent,
} from "@/components/EventCard";
import type { NormalizedArtistBio } from "@/lib/lastfm";
import type { NormalizedSpotifyArtist } from "@/lib/spotify";
import type { NormalizedAppleMusicArtist } from "@/lib/apple-music";
import StreamingServiceLinks from "../components/StreamingServiceLinks";
import AuthNav from "../components/AuthNav";
import LunaSearch from "@/components/LunaSearch";

/**
 * The card UI moved to components/EventCard.tsx when the discovery pages
 * landed (TEA-67), so the search results and the city/genre/artist/venue pages
 * render the same component. Re-exported here so this module's surface is
 * unchanged for everything that already imports from it.
 */
export {
  EventCard,
  EventCardSkeleton,
  formatDate,
  formatPriceRange,
  formatTime,
  toCardEvent,
  type CardEvent,
};

/**
 * The genre chips are the only filter applied after the fetch.
 *
 * There used to be a text and a location filter here as well, narrowing the
 * results by whatever was in the two search inputs. With one field left, the
 * words in it are search *parameters* - Luna turns them into a keyword, a
 * genre, a date, a place - so re-applying them to the response would throw
 * away events that match the search the user actually got.
 */
export function filterCardEvents(
  events: CardEvent[],
  activeGenre: string,
): CardEvent[] {
  if (activeGenre === "All") return events;

  return events.filter((event) => event.genre === activeGenre);
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [activeGenre, setActiveGenre] = useState("All");
  const [hasSearched, setHasSearched] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const [events, setEvents] = useState<CardEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<CardEvent | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);


  const pathname = usePathname();

  const initialLimit = 6;
  const itemsPerLoad = 6;

  const [visibleCount, setVisibleCount] = useState(initialLimit);

  // One line describing the search that produced these results, shown above
  // them: Luna's reading of the query, or the state a bare state code meant.
  const [searchInterpretation, setSearchInterpretation] = useState<
    string | null
  >(null);

  // Genres available, derived from the fetched events so the chips only
  // ever show options that actually have results. Ticketmaster searches
  // return a small number of events, so these are cheap to recompute on
  // every render - no need for useMemo here.
  const genres = [
    "All",
    ...new Set(events.map((e) => e.genre).filter(Boolean)),
  ];

  const filtered = useMemo(
    () => filterCardEvents(events, activeGenre),
    [events, activeGenre],
  );

  const currentYear = new Date().getFullYear();

  const visibleCards = filtered.slice(0, visibleCount);
  const completeCardEvents = visibleCards.filter(
    (event) =>
      event.id &&
      event.artist &&
      event.venue &&
      event.city &&
      event.state &&
      event.date &&
      event.time &&
      event.genre &&
      event.image
  );

  const handleLoadMore = async () => {
    setIsLoadingMore(true);

    try {
      // Future API pagination here:
      setVisibleCount((prevCount) => prevCount + itemsPerLoad);
    } catch (error) {
      console.error("Failed to load more events:", error);
    } finally {
      setIsLoadingMore(false);
    }
  };

  /*
   * LunaSearch runs the whole search - it resolves the query and fetches
   * /api/concerts itself - so the page only reacts to the three points that
   * change what is on screen. Kept in one object because the field moves
   * between the hero and the header and both placements behave identically.
   */
  const searchHandlers = {
    onSearchStart: (interpretation?: string) => {
      setFetchError(null);
      setEvents([]);
      setActiveGenre("All");
      setVisibleCount(initialLimit);
      setSearchInterpretation(interpretation ?? null);
      setHasSearched(true);
      setIsLoading(true);
    },
    onSearchSuccess: (concerts: NormalizedConcert[]) => {
      setEvents(concerts.map(toCardEvent));
      setIsLoading(false);
    },
    onSearchError: (message: string) => {
      setFetchError(message);
      setEvents([]);
      setIsLoading(false);
    },
  };

  const handleGenreClick = (g: string) => {
    setActiveGenre(g);
    setVisibleCount(initialLimit);
  };

  const handleModalOpen = (event: CardEvent) => {
    setSelectedEvent(event);
  }

  const handleTicketClick = (event: CardEvent) => {
    if (!event.ticketUrl) return;

    window.open(event.ticketUrl, "_blank", "noreferrer");
  };

  return (
    <div
      className="min-h-screen bg-background text-foreground"
      style={{ fontFamily: "'DM Sans', sans-serif" }}
    >
      {/* Navigation */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 flex items-center gap-6 h-16">

          {/* Brand */}
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <div className="flex w-7 h-7 rounded-md bg-primary flex items-center justify-center">
              <Music2 size={14} className="text-white" />
            </div>

            <span
              className="text-sm font-bold tracking-widest uppercase"
              style={{
                fontFamily: "'Unbounded', sans-serif",
                letterSpacing: "0.12em",
              }}
            >
              JAMSPOT
            </span>
          </Link>

          {/* Navigation */}
          <nav className="flex items-center gap-6">
            <Link 
              href="/reviews-page"
              className={`text-sm font-medium transition-colors ${
                pathname === "/reviews-page"
                  ? "text-primay"
                  : "text-muted-foreground hover: text-primary"
              }`}
            >
              Reviews
            </Link>
          </nav>

          {/* The search field lives in the hero until the first search, then
              moves up here so it stays reachable above the results. Only ever
              one of the two is mounted, and the query is held by this page,
              so what the user typed survives the move. */}
          <div className="flex flex-1 justify-end">
            {hasSearched && (
              <LunaSearch
                variant="header"
                value={query}
                onChange={setQuery}
                {...searchHandlers}
              />
            )}
          </div>

          <AuthNav />
        </div>
      </header>

      {/* Main content / Hidden cards by default*/}
      {hasSearched === false ? (
        <section className="relative h-[480px] sm:h-[560px] overflow-hidden">
          <div className="absolute inset-0 bg-[#07070f]">
            <Image
              src="https://images.unsplash.com/photo-1470229538611-16ba8c7ffbd7?q=80&w=1470&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D"
              alt="Massive Attack"
              fill
              priority
              sizes="100vw"
              className="object-cover opacity-60"
            />
          </div>

          {/* gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-background/90 via-transparent to-transparent" />

                    <div className="relative flex h-full flex-col items-center justify-center gap-8 px-6 lg:px-12">
            <h1
              className="leading-none tracking-tight text-white text-4xl lg:text-6xl uppercase text-center"
              style={{ fontFamily: "'Unbounded', sans-serif" }}
            >
              Find your next Jam
            </h1>

            {/* JamSpot's only search field (TEA-51). A bare state goes
                straight to Ticketmaster; everything else goes through the
                concert-query Edge Function first. Both end up at the same
                /api/concerts route and the same card grid. */}
            <LunaSearch
              variant="hero"
              value={query}
              onChange={setQuery}
              {...searchHandlers}
            />

            <p className="max-w-xl text-center text-sm text-white/60">
              Ask for a mood, an artist, a night out, or a price - or type a
              state to see everything playing there.
            </p>
          </div>
        </section>
      ) : (
        <main className="max-w-7xl mx-auto px-4 sm:px-6 py-10">
          {/* Genre chips */}
          <div className="flex gap-2 flex-wrap mb-8">
            {genres.map((g) => (
              <button
                key={g}
                onClick={() => handleGenreClick(g)}
                className={`text-xs px-4 py-1.5 rounded-full border transition-all font-medium cursor-pointer ${
                  activeGenre === g
                    ? "bg-primary border-primary text-white"
                    : "bg-muted border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                }`}
                style={{ fontFamily: "'DM Mono', monospace" }}
              >
                {g}
              </button>
            ))}
          </div>

          {/* Results header */}
          <div className="flex items-baseline justify-between mb-6">
            <h2
              className="text-lg font-bold text-foreground"
              style={{
                fontFamily: "'Unbounded', sans-serif",
                fontSize: "1rem",
              }}
            >
              {activeGenre === "All" ? "Upcoming Shows" : activeGenre}
            </h2>
            <span
              className="text-sm text-muted-foreground"
              style={{ fontFamily: "'DM Mono', monospace" }}
            >
              {filtered.length} event{filtered.length !== 1 ? "s" : ""}
            </span>
          </div>

          {/* How the query was read - Luna's sentence, or the state it named. */}
          {searchInterpretation && (
            <p className="-mt-3 mb-6 text-sm text-muted-foreground">
              {searchInterpretation}
            </p>
          )}

          {/* Events grid */}
          {isLoading ? (
            <ul className="grid w-full grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, index) => (
                <EventCardSkeleton key={index} />
              ))}
            </ul>
          ) : fetchError ? (
            <div className="text-center py-24">
              <Music2
                size={40}
                className="text-muted-foreground mx-auto md-4 opacity-40"
              />
              <p className="text-muted-foreground">{fetchError}</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-24">
              <Music2
                size={40}
                className="text-muted-foreground mx-auto md-4 opacity-40"
              />
              <p className="text-muted-foreground">
                No shows found. Try a different search.
              </p>
            </div>
          ) : (
            <div className="flex flex-col">
              <ul className="grid w-full grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {completeCardEvents.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    onOpen={handleModalOpen}
                    onTicketClick={handleTicketClick}
                  />
                ))}

                {isLoadingMore &&
                  Array.from({ length: itemsPerLoad }).map((_, index) => (
                    <EventCardSkeleton key={`skeleton-${index}`} />
                  ))}
              </ul>
              {visibleCount < filtered.length && (
                <div className="mt-6 flex justify-center">
                  <button
                    type="button"
                    onClick={handleLoadMore}
                    disabled={isLoadingMore}
                    className="text-sm px-6 py-2.5 md:px-8 md:py-3 lg:px-10 rounded-full border bg-muted border-primary/40 text-foreground transition-all font-medium cursor-pointer hover:bg-primary hover:border-primary"
                  >
                    {isLoadingMore ? "Loading..." : "Show more"}
                  </button>
                </div>
              )}
            </div>
          )}
        </main>
      )}

      {/* Footer */}
      <footer className="border-t border-border mt-16 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-primary/30 flex items-center justify-center">
              <Music2 size={10} className="text-primary" />
            </div>
            <span
              className="text-xs tracking-widest text-muted-foreground uppercase"
              style={{ fontFamily: "'Unbounded', sans-serif" }}
            >
              JAMSPOT
            </span>
          </div>
          <p
            className="text-xs text-muted-foreground"
            style={{ fontFamily: "'DM Mono', monospace" }}
          >
            &copy; {currentYear} · Events are updated daily
          </p>
        </div>
      </footer>

      {/* Modal */}
      {/* Mounted only while an event is selected, and keyed by event id, so
          React tears down and re-creates the modal (resetting the Last.fm
          bio state back to "loading") whenever a different artist is opened. */}
      {selectedEvent && (
        <EventDetailsModal
          key={selectedEvent.id}
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
        />
      )}
    </div>
  );
}

interface EventDetailsModalProps {
  event: CardEvent;
  onClose: () => void;
}

type FetchState<T> = {
  data: T | null;
  isLoading: boolean;
  error: string | null;
};

const initialFetchState = <T,>(): FetchState<T> => ({
  data: null,
  isLoading: true,
  error: null,
});

export function EventDetailsModal ({
  event,
  onClose,
} : EventDetailsModalProps) {
  const [isBioExpanded, setIsBioExpanded] = useState(false);
  // TEA-22: Last.fm artist biography.
  const [bio, setBio] = useState<FetchState<NormalizedArtistBio>>(
    initialFetchState,
  );
  // TEA-19 / TEA-23: Spotify artist link.
  const [spotify, setSpotify] = useState<FetchState<NormalizedSpotifyArtist>>(
    initialFetchState,
  );
  // TEA-21 / TEA-24: Apple Music artist link.
  const [appleMusic, setAppleMusic] = useState<
    FetchState<NormalizedAppleMusicArtist>
  >(initialFetchState);

  const artistName = event.artist;

  // All three go through our own API routes so provider credentials never
  // reach the browser. They're fired independently and tracked in separate
  // state, so one provider being down or rate-limited never blocks the
  // others from rendering.
  useEffect(() => {
    const controller = new AbortController();
    const query = `name=${encodeURIComponent(artistName)}`;

    loadArtistData<{ bio: NormalizedArtistBio | null }, NormalizedArtistBio>(
      `/api/artist/lastfm?${query}`,
      controller.signal,
      (res) => res.bio ?? null,
      setBio,
      "Failed to load artist bio",
    );

    loadArtistData<
      { artist: NormalizedSpotifyArtist | null },
      NormalizedSpotifyArtist
    >(
      `/api/artist/spotify?${query}`,
      controller.signal,
      (res) => res.artist ?? null,
      setSpotify,
      "Failed to load Spotify artist",
    );

    loadArtistData<
      { artist: NormalizedAppleMusicArtist | null },
      NormalizedAppleMusicArtist
    >(
      `/api/artist/apple-music?${query}`,
      controller.signal,
      (res) => res.artist ?? null,
      setAppleMusic,
      "Failed to load Apple Music artist",
    );

    return () => controller.abort();
  }, [artistName]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 cursor-pointer"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-card shadow-xl cursor-default"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close */}
        <button
          type="button"
          aria-label="Close concert details"
          className="absolute right-3 top-3 z-10 rounded-full bg-black/50 p-2 text-white hover:bg-black/70 cursor-pointer"
          onClick={onClose}
        >
          <X size={18} />
        </button>

        {/* Image */}
        <div className="relative h-56">
          <Image 
            src={event.image}
            alt={event.artist}
            fill
            className="object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-card via-card/30 to-transparent" />

          <div className="absolute bottom-4 left-4">
            <span
              className="rounded bg-black/60 px-2 py-1 text-xs text-white"
              style={{ fontFamily: "'DM Mono', monospace" }}
            >
              {event.genre}
            </span>

            <h2
              className="mt-2 text-2xl font-black text-white"
              style={{ fontFamily: "'Unbounded', sans-serif" }}
            >
              {event.artist}
            </h2>
          </div>
        </div>

        {/* Content */}
        <div className="space-y-2 p-4">
          <div className="flex items-center gap-2 text-sm">
            <Calendar size={16} className="text-primary" />
            <span>{event.date}</span>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <Clock size={16} className="text-primary" />
            <span>{event.time}</span>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <MapPin size={16} className="mt-0.5 text-primary" />
            <span>
              {event.venue}
              <br />
              {event.city}, {event.state}
            </span>
          </div>

          {/* Conditional price section */}
          {event.priceRange && (
            <div className="border-t border-border pt-4">
              <p
                className="text-xs uppercase text-muted-foreground"
                style={{ fontFamily: "'DM Mono', monospace" }}
              >
                Price
              </p>

              <p className="mt-1 font-semibold">{event.priceRange}</p>
            </div>
          )}

          {/* TEA-22: Last.fm artist summary */}
          <div className="border-t border-border pt-4">
            <p
              className="mb-2 text-xs uppercase text-muted-foreground"
              style={{ fontFamily: "'DM Mono', monospace" }}
            >
              About {event.artist}
            </p>

            {bio.isLoading ? (
              <div className="space-y-2" aria-hidden="true">
                <div className="h-3 w-full rounded bg-muted animate-pulse" />
                <div className="h-3 w-full rounded bg-muted animate-pulse" />
                <div className="h-3 w-2/3 rounded bg-muted animate-pulse" />
              </div>
            ) : bio.error ? (
              <p className="text-sm leading-6 text-muted-foreground">
                Bio unavailable right now.
              </p>
            ) : bio.data?.summary ? (
              <div>
               <p 
                className={`text-sm leading-6 text-muted-foreground ${
                  isBioExpanded ? "" : "line-clamp-5"
                }`}
              >
                  {bio.data.summary}
               </p>

               <button
                 onClick={() => setIsBioExpanded((prev) => !prev)}
                  className="mt-2 text-sm text-primary cursor-pointer"
               >
                  {isBioExpanded ? "Show less" : "Read more"}
               </button>
              </div>
            ) : (
              <p className="text-sm leading-6 text-muted-foreground">
                No biography found for this artist.
              </p>
            )}
          </div>

          {/* TEA-19/21/23/24: streaming links */}
          <div className="border-t border-border pt-4">
            <p
              className="mb-2 text-xs uppercase text-muted-foreground"
              style={{ fontFamily: "'DM Mono', monospace" }}
            >
              Listen
            </p>

            <StreamingServiceLinks
              artistName={artistName}
              appleMusic={{
                isLoading: appleMusic.isLoading,
                url: appleMusic.data?.url ?? null,
              }}
              spotify={{
                isLoading: spotify.isLoading,
                url: spotify.data?.url ?? null,
              }}
            />
          </div>

          {event.ticketUrl && (
            <a
              href={event.ticketUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 font-medium text-primary-foreground hover:opacity-90"
            >
              <Ticket size={16} />
              Get Tickets
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Fire one artist-enrichment request and funnel the outcome into `setState`.
 * Aborts are swallowed on purpose: the only time we abort is on unmount or an
 * artist change, and writing state then would flash an empty result before the
 * replacement request lands.
 */
export function loadArtistData<Res, Data>(
  url: string,
  signal: AbortSignal,
  select: (res: Res) => Data | null,
  setState: (state: FetchState<Data>) => void,
  fallbackError: string,
) {
  fetchArtistData<Res>(url, signal)
    .then((res) =>
      setState({ data: select(res), isLoading: false, error: null }),
    )
    .catch((err) => {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setState({
        data: null,
        isLoading: false,
        error: err instanceof Error ? err.message : fallbackError,
      });
    });
}

export async function fetchArtistData<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data?.error ?? "Request failed");
  }

  return data as T;
}
