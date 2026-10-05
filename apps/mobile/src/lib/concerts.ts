import type {
  NormalizedAppleMusicArtist,
  NormalizedArtistBio,
  NormalizedConcert,
  NormalizedSpotifyArtist,
} from '@jamspot/shared';

import { apiFetch } from '@/lib/api';

const FALLBACK_IMAGE = 'https://picsum.photos/400/250?random=1';

/**
 * Run a search that has already been resolved into a query string by
 * `resolveConcertSearch` - the state-name bypass and Luna both produce one.
 * Used to re-run the search on screen when the list is pulled to refresh.
 */
export async function fetchConcertSearch(search: string): Promise<NormalizedConcert[]> {
  const { concerts } = await apiFetch<{ concerts: NormalizedConcert[] }>(
    `/api/concerts?${search}`,
  );
  return concerts;
}

export async function getArtistBio(name: string): Promise<NormalizedArtistBio | null> {
  const { bio } = await apiFetch<{ bio: NormalizedArtistBio | null }>(
    `/api/artist/lastfm?name=${encodeURIComponent(name)}`,
  );
  return bio;
}

export async function getSpotifyArtist(name: string): Promise<NormalizedSpotifyArtist | null> {
  const { artist } = await apiFetch<{ artist: NormalizedSpotifyArtist | null }>(
    `/api/artist/spotify?name=${encodeURIComponent(name)}`,
  );
  return artist;
}

export async function getAppleMusicArtist(
  name: string,
): Promise<NormalizedAppleMusicArtist | null> {
  const { artist } = await apiFetch<{ artist: NormalizedAppleMusicArtist | null }>(
    `/api/artist/apple-music?name=${encodeURIComponent(name)}`,
  );
  return artist;
}

/** Shape the UI renders. Derived from NormalizedConcert, same as web's CardEvent. */
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

export function formatDate(date: string | null | undefined): string {
  if (!date) return 'Date TBA';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(date));
}

export function formatTime(time: string | null | undefined): string {
  if (!time) return 'Time TBA';
  const [hours, minutes] = time.split(':').map(Number);
  const date = new Date();
  date.setHours(hours, minutes);
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

export function formatPriceRange(priceRange: NormalizedConcert['priceRange']): string | null {
  if (!priceRange) return null;
  const { min, max, currency } = priceRange;
  const symbol = currency === 'USD' ? '$' : `${currency} `;
  if (min === max) return `${symbol}${min}`;
  return `${symbol}${min} - ${symbol}${max}`;
}

export function toCardEvent(concert: NormalizedConcert): CardEvent {
  return {
    id: concert.id,
    artist: concert.artist ?? concert.name,
    venue: concert.venue ?? 'Venue TBA',
    city: concert.city ?? '',
    state: concert.state ?? '',
    date: formatDate(concert.date),
    time: formatTime(concert.time),
    genre: concert.genre ?? 'Other',
    priceRange: formatPriceRange(concert.priceRange),
    image: concert.imageUrl ?? FALLBACK_IMAGE,
    ticketUrl: concert.ticketUrl,
  };
}

/**
 * Web only renders a card once every field it draws is populated
 * (apps/web/app/page.tsx's `completeCardEvents`), so a partially populated
 * Ticketmaster record is dropped rather than shown with blanks in it.
 */
export function isCompleteCardEvent(event: CardEvent): boolean {
  return Boolean(
    event.id &&
      event.artist &&
      event.venue &&
      event.city &&
      event.state &&
      event.date &&
      event.time &&
      event.genre &&
      event.image,
  );
}

/**
 * The genre chips are the only filter applied after the fetch, matching
 * apps/web/app/page.tsx. The words in the search field are parameters the
 * search was built from, so re-applying them to the response would drop
 * events that match the search the user actually got.
 */
export function filterCardEvents(
  events: CardEvent[],
  activeGenre: string,
): CardEvent[] {
  if (activeGenre === 'All') return events;

  return events.filter((event) => event.genre === activeGenre);
}
