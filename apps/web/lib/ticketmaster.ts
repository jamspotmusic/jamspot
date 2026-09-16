import { TICKETMASTER_CACHE_TTL_SECONDS, normalizeSearchValue } from "@/lib/cache-config";
import type { NormalizedConcert } from "@jamspot/shared";

export type { NormalizedConcert };

const TICKETMASTER_EVENTS_URL =
  "https://app.ticketmaster.com/discovery/v2/events.json";
const TICKETMASTER_ATTRACTIONS_URL =
  "https://app.ticketmaster.com/discovery/v2/attractions.json";
const TICKETMASTER_VENUES_URL =
  "https://app.ticketmaster.com/discovery/v2/venues.json";

/**
 * Params accepted by searchConcerts. These map fairly directly to the
 * Ticketmaster Discovery API's query params - see:
 * https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/
 */
export type TicketmasterSearchParams = {
  /** City name, e.g. "Dallas" */
  city?: string;
  /** Two-letter US state code, e.g. "TX" */
  stateCode?: string;
  /** US postal / ZIP code */
  postalCode?: string;
  /** Two-letter ISO country code, e.g. "US" */
  countryCode?: string;
  /**
   * Geohash of a point to search around - the geolocated form of a "near me"
   * search. Ticketmaster's older `latlong` parameter is documented as
   * "deprecated and maybe removed in a future release, please use geoPoint
   * instead", so coordinates are encoded as a geohash before they get here.
   */
  geoPoint?: string;
  /** Search radius around geoPoint / postalCode */
  radius?: number;
  /** Unit for radius. Defaults to "miles". */
  unit?: "miles" | "km";
  /** Free-text search - artist name, event name, etc. */
  keyword?: string;
  /**
   * Ticketmaster attraction id. Narrows to one act by identity rather than by
   * name, which is what the /artists discovery pages need - a keyword search
   * for "The National" also returns tribute bands and hockey leagues.
   */
  attractionId?: string;
  /** Ticketmaster venue id. Same reasoning as attractionId, for /venues. */
  venueId?: string;
  /**
   * Ticketmaster classification. Defaults to "music". Multiple comma-separated
   * values are ORed, which is how a mood search ("chill") becomes a union of
   * genres ("Jazz,Folk,Alternative").
   */
  classificationName?: string;
  /** ISO 8601 date-time, e.g. "2026-08-01T00:00:00Z" */
  startDateTime?: string;
  /** ISO 8601 date-time, e.g. "2026-08-31T23:59:59Z" */
  endDateTime?: string;
  /** Results per page (Ticketmaster max is 200) */
  size?: number;
  page?: number;
  /** e.g. "date,asc" */
  sort?: string;
  /**
   * Ticketmaster's events endpoint has no price parameter, so these are
   * applied to the events it returns rather than to the query. An event with
   * no published price range is kept: absent isn't the same as too expensive.
   */
  minPrice?: number;
  maxPrice?: number;
};

export class TicketmasterApiError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "TicketmasterApiError";
    this.status = status;
  }
}

// --- Minimal typing for the slice of the Ticketmaster response we use ---
// The real payload has many more fields; we only type what normalizeEvent reads.

type TmImage = {
  url: string;
  ratio?: string;
  width?: number;
  height?: number;
};

type TmVenue = {
  id?: string;
  name?: string;
  url?: string;
  images?: TmImage[];
  city?: { name?: string };
  state?: { stateCode?: string; name?: string };
  country?: { countryCode?: string };
};

type TmAttraction = {
  id?: string;
  name?: string;
  url?: string;
  images?: TmImage[];
  classifications?: TmClassification[];
};

type TmClassification = {
  genre?: { name?: string };
  subGenre?: { name?: string };
};

type TmPriceRange = {
  min?: number;
  max?: number;
  currency?: string;
};

type TmEvent = {
  id: string;
  name: string;
  url?: string;
  images?: TmImage[];
  classifications?: TmClassification[];
  priceRanges?: TmPriceRange[];
  dates?: {
    start?: { localDate?: string; localTime?: string };
  };
  _embedded?: {
    venues?: TmVenue[];
    attractions?: TmAttraction[];
  };
};

type TmEventsResponse = {
  _embedded?: {
    events?: TmEvent[];
  };
};

type TmAttractionsResponse = {
  _embedded?: {
    attractions?: TmAttraction[];
  };
};

type TmVenuesResponse = {
  _embedded?: {
    venues?: TmVenue[];
  };
};

/** A Ticketmaster attraction (an act), reduced to what JamSpot renders. */
export type NormalizedAttraction = {
  id: string;
  name: string;
  url: string | null;
  imageUrl: string | null;
  genre: string | null;
  subGenre: string | null;
};

/** A Ticketmaster venue, reduced to what JamSpot renders. */
export type NormalizedVenue = {
  id: string;
  name: string;
  url: string | null;
  imageUrl: string | null;
  city: string | null;
  state: string | null;
  countryCode: string | null;
};

function getApiKey(): string {
  const apiKey = process.env.TICKETMASTER_API_KEY;
  if (!apiKey) {
    throw new TicketmasterApiError(
      "Missing TICKETMASTER_API_KEY environment variable"
    );
  }
  return apiKey;
}

/**
 * One GET against the Discovery API, with the caching and the error mapping
 * every endpoint shares.
 *
 * The events, attractions, and venues endpoints differ only in their path and
 * their query params, so pulling the transport here is what lets the discovery
 * pages (TEA-67) resolve artists and venues through this same data layer -
 * same Data Cache, same rate-limit budget, same TicketmasterApiError - rather
 * than standing up a second, SEO-only Ticketmaster client.
 */
async function requestTicketmaster<T>(
  endpoint: string,
  searchParams: URLSearchParams
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(
      `${endpoint}?${searchParams.toString()}`,
      // Concert listings don't change minute to minute - cache briefly
      // (configurable, default 30 min) so we don't burn through
      // Ticketmaster's rate limit. TEA-30.
      { next: { revalidate: TICKETMASTER_CACHE_TTL_SECONDS } }
    );
  } catch (err) {
    throw new TicketmasterApiError(
      `Failed to reach Ticketmaster: ${
        err instanceof Error ? err.message : "unknown network error"
      }`
    );
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new TicketmasterApiError(
        "Ticketmaster rejected the API key. Check TICKETMASTER_API_KEY.",
        response.status
      );
    }
    if (response.status === 429) {
      throw new TicketmasterApiError(
        "Ticketmaster rate limit exceeded. Try again shortly.",
        response.status
      );
    }
    throw new TicketmasterApiError(
      `Ticketmaster request failed with status ${response.status}`,
      response.status
    );
  }

  return (await response.json()) as T;
}

/**
 * Search Ticketmaster for music events and return them in our normalized
 * shape. Throws TicketmasterApiError on any failure (missing key, network
 * error, non-2xx response) so callers can catch a single error type.
 */
export async function searchConcerts(
  params: TicketmasterSearchParams
): Promise<NormalizedConcert[]> {
  const apiKey = getApiKey();

  const searchParams = new URLSearchParams({
    apikey: apiKey,
    classificationName: params.classificationName ?? "music",
    size: String(params.size ?? 20),
  });

  if (params.city) searchParams.set("city", params.city);
  if (params.stateCode) searchParams.set("stateCode", params.stateCode);
  if (params.postalCode) searchParams.set("postalCode", params.postalCode);
  if (params.countryCode) searchParams.set("countryCode", params.countryCode);
  if (params.geoPoint) searchParams.set("geoPoint", params.geoPoint);
  // Ticketmaster only honours radius alongside geoPoint or postalCode.
  if (params.radius !== undefined && (params.geoPoint || params.postalCode)) {
    searchParams.set("radius", String(params.radius));
    searchParams.set("unit", params.unit ?? "miles");
  }
  // TEA-30: normalize free-text keyword so e.g. "Jazz" and "jazz " build
  // the exact same request URL, and therefore share one Data Cache entry.
  // city/stateCode/postalCode aren't touched here - the route already
  // normalizes their casing consistently before calling searchConcerts.
  if (params.keyword) searchParams.set("keyword", normalizeSearchValue(params.keyword));
  // Identity params, not text: passed through verbatim so they stay exact.
  if (params.attractionId) searchParams.set("attractionId", params.attractionId);
  if (params.venueId) searchParams.set("venueId", params.venueId);
  if (params.startDateTime)
    searchParams.set("startDateTime", params.startDateTime);
  if (params.endDateTime) searchParams.set("endDateTime", params.endDateTime);
  if (params.page) searchParams.set("page", String(params.page));
  if (params.sort) searchParams.set("sort", params.sort);

  const data = await requestTicketmaster<TmEventsResponse>(
    TICKETMASTER_EVENTS_URL,
    searchParams
  );
  const events = data._embedded?.events ?? [];

  return events
    .map(normalizeEvent)
    .filter((concert) => matchesPrice(concert, params));
}

/**
 * Applies a price ceiling/floor Ticketmaster itself can't filter on.
 *
 * An event matches when its published range overlaps the requested one, so a
 * $30-$150 show still counts as "under $60" - there are seats at that price.
 * Events with no published range are kept rather than guessed at.
 */
function matchesPrice(
  concert: NormalizedConcert,
  { minPrice, maxPrice }: TicketmasterSearchParams
): boolean {
  if (minPrice === undefined && maxPrice === undefined) return true;

  const range = concert.priceRange;
  if (!range) return true;

  if (maxPrice !== undefined && range.min > maxPrice) return false;
  if (minPrice !== undefined && range.max < minPrice) return false;

  return true;
}

function normalizeEvent(event: TmEvent): NormalizedConcert {
  const venue = event._embedded?.venues?.[0];
  const attraction = event._embedded?.attractions?.[0];
  const classification = event.classifications?.[0];
  const image = pickBestImage(event.images);
  const priceRange = event.priceRanges?.[0];

  return {
    id: event.id,
    name: event.name,
    artist: attraction?.name ?? null,
    artistId: attraction?.id ?? null,
    venue: venue?.name ?? null,
    venueId: venue?.id ?? null,
    city: venue?.city?.name ?? null,
    state: venue?.state?.stateCode ?? null,
    date: event.dates?.start?.localDate ?? null,
    time: event.dates?.start?.localTime ?? null,
    imageUrl: image?.url ?? null,
    ticketUrl: event.url ?? null,
    genre: classification?.genre?.name ?? null,
    subGenre: classification?.subGenre?.name ?? null,
    priceRange:
      priceRange &&
      priceRange.min !== undefined &&
      priceRange.max !== undefined &&
      priceRange.currency
        ? {
            min: priceRange.min,
            max: priceRange.max,
            currency: priceRange.currency,
          }
        : null,
  };
}

/** Prefer a decent-resolution 16:9 image; fall back to whatever's first. */
function pickBestImage(images: TmImage[] | undefined): TmImage | undefined {
  if (!images || images.length === 0) return undefined;
  return (
    images.find((img) => img.ratio === "16_9" && (img.width ?? 0) >= 1024) ??
    images[0]
  );
}

/**
 * Search Ticketmaster's attractions (acts) by name.
 *
 * Returns candidates, not an answer: "the national" matches a hockey league
 * and a Tom Petty tribute act as well as the band. Picking the right one is
 * the caller's job (lib/discovery/entities.ts matches on an exact slug), which
 * is why this stays a thin, cached search rather than a resolver.
 */
export async function searchAttractions(params: {
  keyword: string;
  classificationName?: string;
  size?: number;
  countryCode?: string;
}): Promise<NormalizedAttraction[]> {
  const searchParams = new URLSearchParams({
    apikey: getApiKey(),
    keyword: normalizeSearchValue(params.keyword),
    classificationName: params.classificationName ?? "music",
    size: String(params.size ?? 20),
  });

  if (params.countryCode) searchParams.set("countryCode", params.countryCode);

  const data = await requestTicketmaster<TmAttractionsResponse>(
    TICKETMASTER_ATTRACTIONS_URL,
    searchParams
  );

  return (data._embedded?.attractions ?? [])
    .filter((attraction): attraction is TmAttraction & { id: string; name: string } =>
      Boolean(attraction.id && attraction.name)
    )
    .map(normalizeAttraction);
}

/** Search Ticketmaster's venues by name. Candidates, same as above. */
export async function searchVenues(params: {
  keyword: string;
  size?: number;
  countryCode?: string;
}): Promise<NormalizedVenue[]> {
  const searchParams = new URLSearchParams({
    apikey: getApiKey(),
    keyword: normalizeSearchValue(params.keyword),
    size: String(params.size ?? 20),
  });

  if (params.countryCode) searchParams.set("countryCode", params.countryCode);

  const data = await requestTicketmaster<TmVenuesResponse>(
    TICKETMASTER_VENUES_URL,
    searchParams
  );

  return (data._embedded?.venues ?? [])
    .filter((venue): venue is TmVenue & { id: string; name: string } =>
      Boolean(venue.id && venue.name)
    )
    .map(normalizeVenue);
}

function normalizeAttraction(
  attraction: TmAttraction & { id: string; name: string }
): NormalizedAttraction {
  const classification = attraction.classifications?.[0];

  return {
    id: attraction.id,
    name: attraction.name,
    url: attraction.url ?? null,
    imageUrl: pickBestImage(attraction.images)?.url ?? null,
    genre: classification?.genre?.name ?? null,
    subGenre: classification?.subGenre?.name ?? null,
  };
}

function normalizeVenue(
  venue: TmVenue & { id: string; name: string }
): NormalizedVenue {
  return {
    id: venue.id,
    name: venue.name,
    url: venue.url ?? null,
    imageUrl: pickBestImage(venue.images)?.url ?? null,
    city: venue.city?.name ?? null,
    state: venue.state?.stateCode ?? null,
    countryCode: venue.country?.countryCode ?? null,
  };
}
