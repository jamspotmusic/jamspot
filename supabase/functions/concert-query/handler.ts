/*
 * Core request handling for the `concert-query` Edge Function.
 *
 * Kept free of the `withSupabase` wrapper (and therefore of any npm/jsr
 * imports) so it can be unit tested directly with `deno test`. index.ts is
 * the deployable entry point and does nothing but apply the wrapper.
 *
 * The function turns a natural-language request into Ticketmaster Discovery
 * API search parameters. Two things the model is deliberately *not* allowed
 * to do: invent a location, and answer the question itself. It reports only
 * the place the user actually named; when that is nothing, the search is
 * anchored to the caller, and this file resolves where the caller is. A
 * caller who won't share a location falls back to searching nationwide.
 */

import {
  logLunaEvent,
  type LunaRateLimiter,
  lunaRateLimitExceededResponse,
  lunaRateLimitUnavailableResponse,
} from "./rate-limit.ts";

export const OPENAI_MODEL = "gpt-5.6-luna";

/*
 * Mapping "chill", "cheap", "something to do tonight" onto genres and a
 * price ceiling is light inference rather than pure extraction, so the model
 * gets a small reasoning budget. The output cap covers the schema plus a
 * one-sentence interpretation.
 */
export const REASONING_EFFORT = "low";
export const MAX_OUTPUT_TOKENS = 700;

/** Used when we geolocate the caller and the model asked for no radius. */
export const DEFAULT_RADIUS_MILES = 50;

/** Ticketmaster accepts far more, but anything larger stops meaning "near". */
export const MAX_RADIUS_MILES = 500;

/**
 * Genre names in Ticketmaster's Music segment. Constraining the model to this
 * list is what stops "chill concert" from becoming `classificationName=chill`,
 * which Ticketmaster matches against nothing.
 */
export const TICKETMASTER_MUSIC_GENRES = [
  "Alternative",
  "Blues",
  "Classical",
  "Country",
  "Dance/Electronic",
  "Folk",
  "Hip-Hop/Rap",
  "Holiday",
  "Jazz",
  "Latin",
  "Metal",
  "New Age",
  "Pop",
  "R&B",
  "Reggae",
  "Religious",
  "Rock",
  "World",
] as const;

export const MAX_GENRES = 3;

/** Ticketmaster `sort` values that are meaningful for this search. */
export const SORT_VALUES = [
  "date,asc",
  "relevance,desc",
  "distance,asc",
] as const;

type RequestBody = {
  query?: unknown;
  timeZone?: unknown;
  location?: unknown;
  geolocationDenied?: unknown;
};

/**
 * Geohash precision handed to Ticketmaster's `geoPoint`. Nine characters is a
 * cell of roughly five metres - far finer than any concert search needs, but
 * it costs nothing and `radius` is what actually sets the search area.
 */
export const GEOHASH_PRECISION = 9;

const GEOHASH_BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

/**
 * Encodes coordinates as a geohash.
 *
 * Ticketmaster's `latlong` parameter is documented as "deprecated and maybe
 * removed in a future release, please use geoPoint instead", and `geoPoint`
 * takes a geohash rather than a pair of numbers - so this is what turns a
 * device's coordinates into something the Discovery API will keep accepting.
 */
export function encodeGeohash(
  latitude: number,
  longitude: number,
  precision: number = GEOHASH_PRECISION,
): string {
  let latMin = -90;
  let latMax = 90;
  let lonMin = -180;
  let lonMax = 180;

  let hash = "";
  let bits = 0;
  let value = 0;
  let evenBit = true;

  // Alternate between halving the longitude range and the latitude range,
  // emitting a base32 character for every five bits.
  while (hash.length < precision) {
    if (evenBit) {
      const mid = (lonMin + lonMax) / 2;

      if (longitude >= mid) {
        value = value * 2 + 1;
        lonMin = mid;
      } else {
        value = value * 2;
        lonMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;

      if (latitude >= mid) {
        value = value * 2 + 1;
        latMin = mid;
      } else {
        value = value * 2;
        latMax = mid;
      }
    }

    evenBit = !evenBit;

    if (++bits === 5) {
      hash += GEOHASH_BASE32[value];
      bits = 0;
      value = 0;
    }
  }

  return hash;
}

/**
 * Location the *caller* supplies - device coordinates from the browser's
 * Geolocation API or Expo Location, or a place the user has already picked.
 * Never sent to the model.
 */
export type CallerLocation = {
  latitude: number | null;
  longitude: number | null;
  city: string | null;
  stateCode: string | null;
  postalCode: string | null;
  countryCode: string | null;
};

export type RawConcertCriteria = {
  city: string | null;
  stateCode: string | null;
  postalCode: string | null;
  countryCode: string | null;
  keyword: string | null;
  genres: string[] | null;
  startDateTime: string | null;
  endDateTime: string | null;
  minPrice: number | null;
  maxPrice: number | null;
  radiusMiles: number | null;
  sort: string | null;
  interpretation: string;
};

export type LocationSource =
  /** The user named a place in the query. */
  | "query"
  /** Device coordinates supplied by the caller. */
  | "device"
  /** A city/state/ZIP the caller already knew. */
  | "caller-place"
  /** Approximate position derived from the request's edge geo headers. */
  | "ip"
  /** Nowhere: the caller would not share a location, so the search is national. */
  | "nationwide";

export type ResolvedLocation = {
  source: LocationSource;
  /** Geohash of the caller's coordinates, for Ticketmaster's `geoPoint`. */
  geoPoint: string | null;
  radiusMiles: number | null;
  city: string | null;
  stateCode: string | null;
  postalCode: string | null;
  countryCode: string | null;
};

export type TicketmasterParams = {
  keyword?: string;
  classificationName?: string;
  city?: string;
  stateCode?: string;
  postalCode?: string;
  countryCode?: string;
  geoPoint?: string;
  radius?: number;
  unit?: "miles";
  startDateTime?: string;
  endDateTime?: string;
  sort?: string;
};

/**
 * Ticketmaster's events endpoint has no price parameter, so a price ceiling
 * cannot be pushed into the query. It comes back as a filter for the caller
 * to apply against each event's `priceRanges`.
 */
export type PriceFilter = {
  minPrice?: number;
  maxPrice?: number;
  currency: "USD";
};

type OpenAIResponse = {
  model?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
};

const outputSchema = {
  type: "object",
  properties: {
    city: {
      type: ["string", "null"],
      description:
        "City the user named. Null when they named no place - JamSpot geolocates instead.",
    },
    stateCode: {
      type: ["string", "null"],
      description:
        "Two-letter US state code the user named, normalized from a state name when necessary. Null when they named no place.",
    },
    postalCode: {
      type: ["string", "null"],
      description:
        "Postal or ZIP code the user named. Null when they named no place.",
    },
    countryCode: {
      type: ["string", "null"],
      description:
        "Two-letter ISO country code the user named. Null when they named no place.",
    },
    keyword: {
      type: ["string", "null"],
      description:
        "Free-text Ticketmaster search term: an artist, band, venue, festival, or event name the user actually named. Null for a purely vibe-based request - use genres instead.",
    },
    genres: {
      type: ["array", "null"],
      items: {
        type: "string",
        enum: [...TICKETMASTER_MUSIC_GENRES],
      },
      description:
        "Up to three Ticketmaster Music genres matching the mood or style requested. Null when the user named no style and no mood.",
    },
    startDateTime: {
      type: ["string", "null"],
      description:
        "Start of the requested date range as an ISO-8601 UTC timestamp.",
    },
    endDateTime: {
      type: ["string", "null"],
      description:
        "End of the requested date range as an ISO-8601 UTC timestamp.",
    },
    minPrice: {
      type: ["number", "null"],
      description:
        "Lowest acceptable ticket price in USD, when the user set a floor.",
    },
    maxPrice: {
      type: ["number", "null"],
      description:
        'Highest acceptable ticket price in USD, when the user set a ceiling such as "under $60".',
    },
    radiusMiles: {
      type: ["number", "null"],
      description:
        'Search radius in miles when the user implied one ("within 20 miles", "walking distance", "anywhere in the Bay Area"). Null to let JamSpot choose.',
    },
    sort: {
      type: ["string", "null"],
      enum: [...SORT_VALUES, null],
      description:
        'Ticketmaster sort order. Use "distance,asc" when the user named no place and wants whatever is closest, "relevance,desc" when a specific artist or venue was named, and "date,asc" otherwise.',
    },
    interpretation: {
      type: "string",
      description:
        "One short sentence, addressed to the user, describing the search being run. Never claims a specific concert exists.",
    },
  },
  required: [
    "city",
    "stateCode",
    "postalCode",
    "countryCode",
    "keyword",
    "genres",
    "startDateTime",
    "endDateTime",
    "minPrice",
    "maxPrice",
    "radiusMiles",
    "sort",
    "interpretation",
  ],
  additionalProperties: false,
} as const;

const instructions = `
You translate natural-language concert discovery requests into
Ticketmaster Discovery API search parameters for JamSpot.

You do NOT provide concert listings.
Ticketmaster is the authoritative source for actual events.

Return only the fields required by the supplied JSON schema.

LOCATION RULES

You never guess where the user is. You report only the place they
actually named, and JamSpot geolocates them whenever that is nothing.

- The user named a place ("in Oakland", "Texas shows", "near 94607"):
  fill city, stateCode, postalCode, or countryCode from what they
  actually said, and leave the rest null.
- The user named no place: return null for city, stateCode,
  postalCode, and countryCode. Every such search runs near the user,
  including one that names an artist, a tour, a festival, or a venue.
  Leaving these null is how you ask for that.
- Convert state names such as "California" to "CA".
- Do not guess a user's city, state, ZIP code, or coordinates.
- Do not infer location from the supplied timeZone.
- timeZone exists only to resolve relative dates.
- Do not put a city, state, or ZIP code into keyword or genres.
- Never manufacture a location the user did not give you.

KEYWORD RULES

- keyword is for something the user actually named: an artist, band,
  venue, festival, tour, or event.
- Do not put a mood word such as "chill", "fun", or "cheap" into
  keyword. Ticketmaster matches keyword literally and would return
  nothing useful.
- Do not put location or date language into keyword.
- If the user named nothing specific, return null.

GENRE RULES

- genres maps the requested style or mood onto Ticketmaster's Music
  genres. Return at most three, ordered most to least likely.
- A named genre maps directly: "jazz" -> ["Jazz"], "punk shows" ->
  ["Alternative", "Rock"].
- A mood maps to the genres that usually carry it, for example
  "chill" -> ["Jazz", "Folk", "Alternative"], "something loud" ->
  ["Metal", "Rock"], "dancing" -> ["Dance/Electronic", "Latin", "Pop"].
- Return null when the user described neither a style nor a mood.
- A specific artist belongs in keyword, not genres.

DATE RULES

- Resolve phrases such as "tonight", "tomorrow", "Friday",
  "this weekend", "next weekend", and "next month" relative to
  currentDateTime and timeZone.
- Return UTC ISO-8601 timestamps ending in Z.
- If the user supplied no date restriction, return null for both
  startDateTime and endDateTime.
- Never use your knowledge cutoff as the current date.

PRICE RULES

- "under $60", "$60 or less", "cheap tickets around 25 bucks" set
  maxPrice.
- "at least $100", "good seats over $200" set minPrice.
- Prices are USD. Return null when the user set no limit.
- Do not claim what a ticket actually costs.

RADIUS RULES

- Set radiusMiles only when the user implied a distance:
  "within 20 miles" -> 20, "walking distance" -> 2,
  "anywhere in the Bay Area" -> 60.
- Otherwise return null and let JamSpot choose.

GENERAL RULES

- Do not claim an artist is actually touring.
- Do not claim a concert exists.
- Do not invent venues, artists, genres, or locations.
- interpretation is one short sentence describing the search you
  built, addressed to the user. When the user named no place, phrase
  it as being near them without naming one.
- Null means the information was not supplied or cannot safely
  be determined.
`;

/* -------------------------------------------------------------------------
 * Normalization of the model's output
 *
 * The JSON schema is strict, so the shape is guaranteed. The values are not:
 * everything below either coerces a value into something Ticketmaster accepts
 * or throws, which the handler turns into a 502 rather than a bad search.
 * ---------------------------------------------------------------------- */

export function normalizeOptionalString(
  value: string | null,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();

  return normalized.length > 0 ? normalized : null;
}

export function normalizeStateCode(
  value: string | null,
): string | null {
  const normalized = normalizeOptionalString(value);

  if (!normalized) {
    return null;
  }

  const stateCode = normalized.toUpperCase();

  if (!/^[A-Z]{2}$/.test(stateCode)) {
    throw new Error("Invalid stateCode returned by model");
  }

  return stateCode;
}

export function normalizeCountryCode(
  value: string | null,
): string | null {
  const normalized = normalizeOptionalString(value);

  if (!normalized) {
    return null;
  }

  const countryCode = normalized.toUpperCase();

  if (!/^[A-Z]{2}$/.test(countryCode)) {
    throw new Error("Invalid countryCode returned by model");
  }

  return countryCode;
}

export function normalizeDateTime(
  value: string | null,
  fieldName: string,
): string | null {
  const normalized = normalizeOptionalString(value);

  if (!normalized) {
    return null;
  }

  const timestamp = Date.parse(normalized);

  if (!Number.isFinite(timestamp)) {
    throw new Error(
      `Invalid ${fieldName} returned by model`,
    );
  }

  // Ticketmaster examples use UTC timestamps ending in Z.
  // Strip milliseconds for a compact, predictable representation.
  return new Date(timestamp)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
}

/**
 * Keeps only genres Ticketmaster actually knows about, de-duplicated and
 * capped. The schema's enum should make this a no-op; it is here because a
 * silently wrong `classificationName` returns zero events with no error.
 */
export function normalizeGenres(
  value: string[] | null,
): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const known = new Map(
    TICKETMASTER_MUSIC_GENRES.map((genre) => [genre.toLowerCase(), genre]),
  );

  const genres: string[] = [];

  for (const entry of value) {
    const normalized = normalizeOptionalString(
      typeof entry === "string" ? entry : null,
    );

    if (!normalized) {
      continue;
    }

    const genre = known.get(normalized.toLowerCase());

    if (genre && !genres.includes(genre)) {
      genres.push(genre);
    }
  }

  return genres.length > 0 ? genres.slice(0, MAX_GENRES) : null;
}

export function normalizePrice(
  value: number | null,
  fieldName: string,
): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid ${fieldName} returned by model`);
  }

  // Whole cents; a ticket price with more precision than that is noise.
  return Math.round(value * 100) / 100;
}

export function normalizeRadiusMiles(
  value: number | null,
): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error("Invalid radiusMiles returned by model");
  }

  // Ticketmaster's radius is an integer, and at least 1.
  return Math.min(Math.max(Math.round(value), 1), MAX_RADIUS_MILES);
}

export function normalizeSort(
  value: string | null,
): string | null {
  const normalized = normalizeOptionalString(value);

  if (!normalized) {
    return null;
  }

  if (!(SORT_VALUES as readonly string[]).includes(normalized)) {
    throw new Error("Invalid sort returned by model");
  }

  return normalized;
}

export function normalizeCriteria(
  criteria: RawConcertCriteria,
): RawConcertCriteria {
  const normalized: RawConcertCriteria = {
    city: normalizeOptionalString(criteria.city),
    stateCode: normalizeStateCode(criteria.stateCode),
    postalCode: normalizeOptionalString(criteria.postalCode),
    countryCode: normalizeCountryCode(criteria.countryCode),
    keyword: normalizeOptionalString(criteria.keyword),
    genres: normalizeGenres(criteria.genres),
    startDateTime: normalizeDateTime(
      criteria.startDateTime,
      "startDateTime",
    ),
    endDateTime: normalizeDateTime(
      criteria.endDateTime,
      "endDateTime",
    ),
    minPrice: normalizePrice(criteria.minPrice, "minPrice"),
    maxPrice: normalizePrice(criteria.maxPrice, "maxPrice"),
    radiusMiles: normalizeRadiusMiles(criteria.radiusMiles),
    sort: normalizeSort(criteria.sort),
    interpretation: normalizeOptionalString(criteria.interpretation) ?? "",
  };

  if (
    normalized.startDateTime &&
    normalized.endDateTime &&
    Date.parse(normalized.startDateTime) >
      Date.parse(normalized.endDateTime)
  ) {
    throw new Error(
      "startDateTime is after endDateTime",
    );
  }

  if (
    normalized.minPrice !== null &&
    normalized.maxPrice !== null &&
    normalized.minPrice > normalized.maxPrice
  ) {
    throw new Error("minPrice is above maxPrice");
  }

  return normalized;
}

/** True when the user named a place, which is the only thing that suppresses
 * geolocation. */
export function hasNamedLocation(
  criteria: RawConcertCriteria,
): boolean {
  return Boolean(
    criteria.city ||
      criteria.stateCode ||
      criteria.postalCode ||
      criteria.countryCode,
  );
}

/* -------------------------------------------------------------------------
 * Locating the caller
 * ---------------------------------------------------------------------- */

export function parseCallerLocation(value: unknown): CallerLocation {
  const empty: CallerLocation = {
    latitude: null,
    longitude: null,
    city: null,
    stateCode: null,
    postalCode: null,
    countryCode: null,
  };

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return empty;
  }

  const raw = value as Record<string, unknown>;

  const latitude = typeof raw.latitude === "number" ? raw.latitude : null;
  const longitude = typeof raw.longitude === "number" ? raw.longitude : null;

  const hasCoordinates = latitude !== null &&
    longitude !== null &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180;

  const text = (key: string) =>
    typeof raw[key] === "string"
      ? normalizeOptionalString(raw[key] as string)
      : null;

  const stateCode = text("stateCode");
  const countryCode = text("countryCode");

  return {
    latitude: hasCoordinates ? latitude : null,
    longitude: hasCoordinates ? longitude : null,
    city: text("city"),
    // A caller-supplied code we can't use is dropped, not fatal - unlike the
    // model's output, this is untrusted client input.
    stateCode: stateCode && /^[A-Za-z]{2}$/.test(stateCode)
      ? stateCode.toUpperCase()
      : null,
    postalCode: text("postalCode"),
    countryCode: countryCode && /^[A-Za-z]{2}$/.test(countryCode)
      ? countryCode.toUpperCase()
      : null,
  };
}

/**
 * Best-effort approximate position from the edge network's geo headers.
 *
 * Whether these arrive depends on what sits in front of the function, so this
 * is a fallback: the accurate path is the caller sending device coordinates.
 * When nothing is present the handler asks the client for a location instead
 * of guessing.
 */
export function geoFromHeaders(headers: Headers): CallerLocation {
  const read = (...names: string[]): string | null => {
    for (const name of names) {
      const value = normalizeOptionalString(headers.get(name));

      if (value) {
        // Vercel percent-encodes city names ("San%20Francisco").
        try {
          return decodeURIComponent(value);
        } catch {
          return value;
        }
      }
    }

    return null;
  };

  const number = (value: string | null): number | null => {
    if (value === null) {
      return null;
    }

    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : null;
  };

  const latitude = number(read("x-vercel-ip-latitude", "cf-iplatitude"));
  const longitude = number(read("x-vercel-ip-longitude", "cf-iplongitude"));

  const hasCoordinates = latitude !== null &&
    longitude !== null &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180;

  const stateCode = read("x-vercel-ip-country-region", "cf-region-code");
  const countryCode = read("x-vercel-ip-country", "cf-ipcountry");

  return {
    latitude: hasCoordinates ? latitude : null,
    longitude: hasCoordinates ? longitude : null,
    city: read("x-vercel-ip-city", "cf-ipcity"),
    stateCode: stateCode && /^[A-Za-z]{2}$/.test(stateCode)
      ? stateCode.toUpperCase()
      : null,
    postalCode: read("x-vercel-ip-postal-code", "cf-postal-code"),
    countryCode: countryCode && /^[A-Za-z]{2}$/.test(countryCode)
      ? countryCode.toUpperCase()
      : null,
  };
}

function hasAnyPlace(location: CallerLocation): boolean {
  return Boolean(
    location.city || location.stateCode || location.postalCode,
  );
}

/**
 * Decides where the search happens, in descending order of trust:
 * the place the user named, then device coordinates, then a place the caller
 * already knew, then the edge network's approximate guess.
 *
 * Every search is located. A query that names no place is geolocated whatever
 * else it names - "Radiohead tickets" searches near the caller, not the whole
 * country. Returns null only when no location can be had at all, which the
 * handler turns into a `location_required` response so the client can ask for
 * permission and retry rather than searching the wrong city.
 */
export function resolveLocation(
  criteria: RawConcertCriteria,
  caller: CallerLocation,
  headers: Headers,
): ResolvedLocation | null {
  if (hasNamedLocation(criteria)) {
    return {
      source: "query",
      geoPoint: null,
      // Ticketmaster only honours a radius alongside a geoPoint or a postal
      // code; with a bare city or state it would be ignored anyway.
      radiusMiles: criteria.postalCode ? criteria.radiusMiles : null,
      city: criteria.city,
      stateCode: criteria.stateCode,
      postalCode: criteria.postalCode,
      countryCode: criteria.countryCode,
    };
  }

  const radiusMiles = criteria.radiusMiles ?? DEFAULT_RADIUS_MILES;

  for (
    const [source, location] of [
      ["device", caller],
      ["caller-place", caller],
      ["ip", geoFromHeaders(headers)],
    ] as const
  ) {
    if (
      source === "device" &&
      location.latitude !== null &&
      location.longitude !== null
    ) {
      return {
        source,
        geoPoint: encodeGeohash(location.latitude, location.longitude),
        radiusMiles,
        city: null,
        stateCode: null,
        postalCode: null,
        countryCode: location.countryCode,
      };
    }

    if (source === "caller-place" && hasAnyPlace(location)) {
      return {
        source,
        geoPoint: null,
        radiusMiles: location.postalCode ? radiusMiles : null,
        city: location.city,
        stateCode: location.stateCode,
        postalCode: location.postalCode,
        countryCode: location.countryCode,
      };
    }

    if (source === "ip") {
      if (location.latitude !== null && location.longitude !== null) {
        return {
          source,
          geoPoint: encodeGeohash(location.latitude, location.longitude),
          radiusMiles,
          city: null,
          stateCode: null,
          postalCode: null,
          countryCode: location.countryCode,
        };
      }

      if (hasAnyPlace(location)) {
        return {
          source,
          geoPoint: null,
          radiusMiles: location.postalCode ? radiusMiles : null,
          city: location.city,
          stateCode: location.stateCode,
          postalCode: location.postalCode,
          countryCode: location.countryCode,
        };
      }
    }
  }

  return null;
}

/**
 * The search a caller gets when they decline to share a location.
 *
 * It needs something to match on: a nationwide search for every music event
 * is not an answer to "concerts tonight", so that query is refused instead.
 * A named artist or a genre is enough.
 */
export function nationwideFallback(
  criteria: RawConcertCriteria,
): ResolvedLocation | null {
  if (!criteria.keyword && !criteria.genres) {
    return null;
  }

  return {
    source: "nationwide",
    geoPoint: null,
    radiusMiles: null,
    city: null,
    stateCode: null,
    postalCode: null,
    countryCode: null,
  };
}

/* -------------------------------------------------------------------------
 * Building the Ticketmaster request
 * ---------------------------------------------------------------------- */

export function toTicketmasterParams(
  criteria: RawConcertCriteria,
  location: ResolvedLocation,
): TicketmasterParams {
  /*
   * Ticketmaster ORs multiple classificationName values, which is what a mood
   * search wants: "chill" becomes Jazz OR Folk OR Alternative. The plain
   * "music" default is only added when no genre was chosen, since ORing it in
   * alongside genres would widen the search back to everything.
   */
  const classificationName = criteria.genres
    ? criteria.genres.join(",")
    : "music";

  /*
   * "distance,asc" is only a valid ordering when Ticketmaster has a point to
   * measure from.
   */
  const sort = criteria.sort === "distance,asc" && !location.geoPoint
    ? "date,asc"
    : criteria.sort;

  const radius = location.radiusMiles !== null &&
      (location.geoPoint || location.postalCode)
    ? location.radiusMiles
    : null;

  return {
    ...(criteria.keyword ? { keyword: criteria.keyword } : {}),
    classificationName,
    ...(location.city ? { city: location.city } : {}),
    ...(location.stateCode ? { stateCode: location.stateCode } : {}),
    ...(location.postalCode ? { postalCode: location.postalCode } : {}),
    ...(location.countryCode ? { countryCode: location.countryCode } : {}),
    ...(location.geoPoint ? { geoPoint: location.geoPoint } : {}),
    ...(radius !== null ? { radius, unit: "miles" as const } : {}),
    ...(criteria.startDateTime
      ? { startDateTime: criteria.startDateTime }
      : {}),
    ...(criteria.endDateTime ? { endDateTime: criteria.endDateTime } : {}),
    ...(sort ? { sort } : {}),
  };
}

export function toPriceFilter(
  criteria: RawConcertCriteria,
): PriceFilter | null {
  if (criteria.minPrice === null && criteria.maxPrice === null) {
    return null;
  }

  return {
    ...(criteria.minPrice !== null ? { minPrice: criteria.minPrice } : {}),
    ...(criteria.maxPrice !== null ? { maxPrice: criteria.maxPrice } : {}),
    currency: "USD",
  };
}

export function extractOutputText(
  response: OpenAIResponse,
): string | null {
  for (const item of response.output ?? []) {
    if (item.type !== "message") {
      continue;
    }

    for (const content of item.content ?? []) {
      if (
        content.type === "output_text" &&
        typeof content.text === "string"
      ) {
        return content.text;
      }
    }
  }

  return null;
}

/* -------------------------------------------------------------------------
 * Routing
 *
 *   request -> routing decision -> Luna required? -> rate-limit check -> Luna call
 *
 * Everything that can be decided without the model is decided here, before
 * the rate limiter, so a malformed or out-of-scope request never uses up Luna
 * capacity. Direct Ticketmaster searches (structured filters) go to
 * /api/concerts and never reach this function.
 * ---------------------------------------------------------------------- */

export const MAX_QUERY_LENGTH = 500;

export type LunaRequest = {
  query: string;
  timeZone: string;
  callerLocation: CallerLocation;
  geolocationDenied: boolean;
};

export type RouteDecision =
  | { route: "luna"; request: LunaRequest }
  | { route: "rejected"; reason: string; response: Response };

function reject(
  reason: string,
  response: Response,
): RouteDecision {
  return { route: "rejected", reason, response };
}

/**
 * Decides whether a request needs Luna. Reads the body only; the model is not
 * involved, so nothing here costs a token.
 */
export async function decideRoute(req: Request): Promise<RouteDecision> {
  if (req.method !== "POST") {
    return reject(
      "method_not_allowed",
      Response.json(
        { error: "Method not allowed" },
        { status: 405, headers: { Allow: "POST" } },
      ),
    );
  }

  let body: RequestBody;

  try {
    body = await req.json();
  } catch {
    return reject(
      "invalid_json",
      Response.json(
        { error: "Request body must contain valid JSON" },
        { status: 400 },
      ),
    );
  }

  // `null`, an array, or a bare string is valid JSON but not a request.
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return reject(
      "invalid_body",
      Response.json(
        { error: "Request body must be a JSON object" },
        { status: 400 },
      ),
    );
  }

  const query = typeof body.query === "string" ? body.query.trim() : "";

  if (!query) {
    return reject(
      "missing_query",
      Response.json({ error: "query is required" }, { status: 400 }),
    );
  }

  if (query.length > MAX_QUERY_LENGTH) {
    return reject(
      "query_too_long",
      Response.json(
        { error: `query must be ${MAX_QUERY_LENGTH} characters or fewer` },
        { status: 400 },
      ),
    );
  }

  const timeZone = typeof body.timeZone === "string" && body.timeZone.trim()
    ? body.timeZone.trim()
    : "UTC";

  return {
    route: "luna",
    request: {
      query,
      timeZone,
      callerLocation: parseCallerLocation(body.location),
      /*
       * Set by a client that asked for the device's location and didn't get
       * it - permission refused, geolocation unsupported, or the request
       * timed out. It's the client's job to report this, because only the
       * client knows whether it has asked yet.
       */
      geolocationDenied: body.geolocationDenied === true,
    },
  };
}

/* -------------------------------------------------------------------------
 * Handler
 * ---------------------------------------------------------------------- */

export type ConcertQueryOptions = {
  /**
   * Verified Supabase user ID from the JWT (`ctx.userClaims.id`), or null
   * for an anonymous caller. Never taken from the request body.
   */
  userId: string | null;
  /** Checked after routing and before every Luna call. Required. */
  rateLimiter: LunaRateLimiter;
};

export async function handleConcertQuery(
  req: Request,
  { userId, rateLimiter }: ConcertQueryOptions,
): Promise<Response> {
  const decision = await decideRoute(req);

  if (decision.route === "rejected") {
    // Rejected before Luna, so the limiter never sees this request.
    logLunaEvent({
      event: "luna_route",
      route: "rejected",
      reason: decision.reason,
    });
    return decision.response;
  }

  const { query, timeZone, callerLocation, geolocationDenied } =
    decision.request;

  const apiKey = Deno.env.get("OPENAI_API_KEY");

  if (!apiKey) {
    // Checked before the limiter: a request that can't reach Luna must not
    // use up capacity.
    console.error(
      "OPENAI_API_KEY is not configured",
    );

    return Response.json(
      {
        error:
          "Concert query service is not configured",
      },
      { status: 500 },
    );
  }

  /*
   * Checked immediately before the provider request. A rejected or
   * unavailable result returns here: there is no other path to the model.
   */
  const limit = await rateLimiter.check({ userId, headers: req.headers });

  if (limit.outcome === "rejected") {
    return lunaRateLimitExceededResponse(limit.retryAfterSeconds);
  }

  if (limit.outcome === "unavailable") {
    return lunaRateLimitUnavailableResponse();
  }

  const currentDateTime =
    new Date().toISOString();

  let openAIResponse: Response;

  try {
    openAIResponse = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,

          // Mostly extraction, with some mood-to-genre inference.
          reasoning: {
            effort: REASONING_EFFORT,
          },

          store: false,

          max_output_tokens: MAX_OUTPUT_TOKENS,

          instructions,

          /*
           * The caller's location is deliberately absent. The model decides
           * whether a search should be local; it never learns where the user
           * is, so it cannot leak that into a keyword or an interpretation.
           */
          input: JSON.stringify({
            query,
            currentDateTime,
            timeZone,
          }),

          text: {
            format: {
              type: "json_schema",
              name: "ticketmaster_search_parameters",
              strict: true,
              schema: outputSchema,
            },
          },
        }),
      },
    );
  } catch (error) {
    console.error(
      "Failed to reach OpenAI",
      error,
    );

    return Response.json(
      {
        error:
          "Unable to interpret concert query",
      },
      { status: 502 },
    );
  }

  const requestId =
    openAIResponse.headers.get("x-request-id");

  let payload: OpenAIResponse;

  try {
    payload =
      (await openAIResponse.json()) as OpenAIResponse;
  } catch {
    console.error(
      "OpenAI returned an invalid JSON response",
      {
        status: openAIResponse.status,
        requestId,
      },
    );

    return Response.json(
      {
        error:
          "Unable to interpret concert query",
      },
      { status: 502 },
    );
  }

  if (!openAIResponse.ok) {
    console.error("OpenAI request failed", {
      status: openAIResponse.status,
      requestId,
    });

    return Response.json(
      {
        error:
          "Unable to interpret concert query",
      },
      { status: 502 },
    );
  }

  const outputText =
    extractOutputText(payload);

  if (!outputText) {
    console.error(
      "OpenAI response contained no output text",
      {
        requestId,
      },
    );

    return Response.json(
      {
        error:
          "Unable to interpret concert query",
      },
      { status: 502 },
    );
  }

  let criteria: RawConcertCriteria;

  try {
    const parsed = JSON.parse(
      outputText,
    ) as RawConcertCriteria;

    criteria = normalizeCriteria(parsed);
  } catch (error) {
    console.error(
      "Invalid structured output from OpenAI",
      {
        requestId,
        error:
          error instanceof Error
            ? error.message
            : "unknown error",
      },
    );

    return Response.json(
      {
        error:
          "Unable to interpret concert query",
      },
      { status: 502 },
    );
  }

  /*
   * The query named no place and nothing here can locate the caller. If the
   * client has already been refused a location, widen to a nationwide search;
   * otherwise ask it to request permission and retry, rather than picking a
   * city on the user's behalf.
   */
  const location = resolveLocation(
    criteria,
    callerLocation,
    req.headers,
  ) ?? (geolocationDenied ? nationwideFallback(criteria) : null);

  if (!location) {
    return geolocationDenied
      ? Response.json(
        {
          error:
            "Include an artist, genre, venue, event, city, state, or ZIP code.",
          code: "anchor_required",
          interpretation: criteria.interpretation,
        },
        { status: 422 },
      )
      : Response.json(
        {
          error:
            "Share your location or name a city to find shows near you.",
          code: "location_required",
          interpretation: criteria.interpretation,
        },
        { status: 422 },
      );
  }

  const priceFilter = toPriceFilter(criteria);

  return Response.json({
    query,
    interpretation: criteria.interpretation,
    ticketmasterParams:
      toTicketmasterParams(criteria, location),
    // Ticketmaster cannot filter on price, so the caller applies this to the
    // events it gets back.
    ...(priceFilter ? { filters: priceFilter } : {}),
    meta: {
      model:
        payload.model ?? OPENAI_MODEL,
      timeZone,
      currentDateTime,
      locationSource: location.source,
    },
  });
}
