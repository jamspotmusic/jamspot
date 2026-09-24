// Types shared between the JamSpot web app (apps/web) and the JamSpot
// mobile app (apps/mobile) — the normalized, front-end-friendly shapes the
// Next.js API routes (apps/web/app/api/**) return as JSON, so both clients
// can type their fetch/response handling against the same contract.
//
// Ships as raw TypeScript with no build step (see package.json's
// "main"/"types"/"exports"): Next.js consumes it via `transpilePackages`
// in apps/web/next.config.ts, and Metro (Expo) transpiles TypeScript
// on the fly, so neither bundler needs a prebuilt dist/.

/** Clean, front-end-friendly shape a Ticketmaster event is normalized into.
 *  Source of truth was apps/web/lib/ticketmaster.ts. */
export type NormalizedConcert = {
  id: string;
  name: string;
  artist: string | null;
  /**
   * Ticketmaster attraction id for `artist`, when the event has one.
   *
   * Names are not identities: two acts can share one, and one act can be
   * spelled several ways across events. The discovery pages (TEA-67) key
   * artists off this instead, so /artists/<slug> always means one attraction.
   */
  artistId: string | null;
  venue: string | null;
  /**
   * Ticketmaster venue id for `venue`. Same reasoning as `artistId`, and
   * more load-bearing: "House of Blues" names a dozen different rooms.
   */
  venueId: string | null;
  city: string | null;
  state: string | null;
  date: string | null;
  time: string | null;
  imageUrl: string | null;
  ticketUrl: string | null;
  genre: string | null;
  subGenre: string | null;
  priceRange: { min: number; max: number; currency: string } | null;
};

/**
 * The author of a review, embedded from the `profiles` table via
 * `reviews.author_id`.
 *
 * Every field is optional and the whole object is nullable: a review whose
 * `author_id` has no matching `profiles` row comes back with `profiles: null`,
 * which is the case for the rows in the database today. Render it defensively
 * (both clients fall back to "Anonymous").
 */
export type ReviewAuthor = {
  id?: string;
  username?: string | null;
  created_at?: string;
};

/**
 * Row shape of the `reviews` table, as the database actually returns it.
 *
 * Verified against the live PostgREST schema rather than transcribed from
 * older code: the earlier `musician` / `venue` / `concert_date` /
 * `review_text` / `user_name` columns no longer exist, and the table now
 * carries a star rating, a free-text `location`, and an `author_id` pointing
 * at `profiles`.
 *
 * `profiles` is included by a plain `select("*")` — see apps/web/lib/reviews.ts.
 *
 * There are no vote columns. Upvote/downvote counts in the UI are
 * presentational only and are not persisted anywhere.
 */
export type Review = {
  id: string;
  short_description: string;
  description: string;
  star_rating: number;
  /** Free text, e.g. "Golden 1 Center, Sacramento, CA" - not split into venue/city/state. */
  location: string;
  /** ISO date, e.g. "2026-08-07". Date-only: no time component. */
  review_date: string;
  created_at: string;
  updated_at: string;
  author_id: string;
  profiles: ReviewAuthor | null;
};

/**
 * Fields needed to create a new review.
 *
 * `author_id` is deliberately absent: it comes from the caller's authenticated
 * session server-side, never from client input, since Row Level Security
 * requires it to match the signed-in user.
 */
export type NewReview = {
  shortDescription: string;
  description: string;
  starRating: number;
  location: string;
  reviewDate: string;
};

/** Fields that can be changed on an existing review. All optional. */
export type ReviewUpdate = Partial<NewReview>;

/** Clean, front-end-friendly shape a Spotify artist is normalized into.
 *  Source of truth was apps/web/lib/spotify.ts. */
export type NormalizedSpotifyArtist = {
  id: string;
  name: string;
  /** Link to the artist's Spotify page. */
  url: string | null;
  imageUrl: string | null;
  genres: string[];
  followers: number | null;
  popularity: number | null;
};

/** Clean, front-end-friendly shape an Apple Music (iTunes) artist is
 *  normalized into. Source of truth was apps/web/lib/apple-music.ts. */
export type NormalizedAppleMusicArtist = {
  id: number;
  name: string;
  /** Link to the artist's Apple Music page. */
  url: string | null;
  primaryGenre: string | null;
};

/** Clean, front-end-friendly shape a Last.fm artist bio is normalized into.
 *  Source of truth was apps/web/lib/lastfm.ts. */
export type NormalizedArtistBio = {
  name: string;
  /** Short bio with HTML stripped and the trailing "Read more on Last.fm"
   *  link removed. Null if Last.fm has no bio on file for this artist. */
  summary: string | null;
  /** Full-length bio, same cleanup applied as `summary`. */
  content: string | null;
  /** Link to the artist's Last.fm page. */
  url: string | null;
  /** Last.fm's listener count for the artist, if available. */
  listeners: number | null;
};

// ---------------------------------------------------------------------------
// Passwordless email-OTP auth
// ---------------------------------------------------------------------------
//
// Inlined here rather than kept in its own module and re-exported: a relative
// `export * from "./auth"` needs an explicit .ts extension under Node's ESM
// resolver (which the web unit tests hit) but cannot have one under tsc's
// "bundler" resolution without allowImportingTsExtensions in every consuming
// tsconfig. One entry file resolves identically in Next, Metro, and Node.
//
// Unlike everything above, these are runtime exports, not just types.
//
// Both apps authenticate against the SAME Supabase project, so they share one
// Auth user population and must agree on how a code is requested, verified,
// and how failures are worded. That agreement lives here.
//
// What deliberately does NOT live here: the Supabase client itself. Web needs
// cookie-backed sessions via @supabase/ssr, mobile needs AsyncStorage-backed
// sessions plus AppState-driven token refresh — two different instantiations
// that cannot be one object. Instead the functions below take the client's
// `auth` surface as a parameter, typed structurally (see OtpAuthClient), which
// keeps this module free of any dependency on @supabase/supabase-js and free
// of any browser-only or React-Native-only API. That also makes every function
// here testable against a plain fake object.

/** Digits in the emailed code. Mirrors the Supabase project's OTP length. */
export const EMAIL_OTP_LENGTH = 8;

/**
 * The subset of `supabase.auth` these helpers touch, described structurally so
 * this package needs no Supabase dependency. A real SupabaseClient["auth"]
 * satisfies it.
 */
export type OtpAuthClient = {
  signInWithOtp(credentials: {
    email: string;
    options?: { shouldCreateUser?: boolean };
  }): Promise<{ error: AuthErrorLike | null }>;
  verifyOtp(params: {
    email: string;
    token: string;
    type: "email";
  }): Promise<{
    data: { session: unknown | null; user: unknown | null };
    error: AuthErrorLike | null;
  }>;
  signOut(): Promise<{ error: AuthErrorLike | null }>;
};

/** The parts of Supabase's AuthError worth branching on. */
export type AuthErrorLike = {
  message: string;
  /** Stable machine-readable code on recent supabase-js versions. */
  code?: string;
  status?: number;
  name?: string;
};

/** Where a client is in the auth lifecycle. Renderers switch on this. */
export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

/** Which half of the two-step OTP form is on screen. */
export type OtpStep = "email" | "code";

/** The authenticated identity both apps surface. */
export type AuthUser = {
  id: string;
  email: string | null;
};

/** Outcome of an auth action: either it worked, or there's a message to show. */
export type AuthResult = { ok: true } | { ok: false; message: string };

const GENERIC_SEND_FAILURE =
  "We couldn't send your code. Please try again in a moment.";
const GENERIC_VERIFY_FAILURE =
  "We couldn't verify that code. Please try again.";
const GENERIC_SESSION_FAILURE =
  "Something went wrong with your session. Please sign in again.";
const NETWORK_FAILURE =
  "Can't reach JamSpot right now. Check your connection and try again.";

/**
 * Deliberately permissive: one @, something before it, and a dotted domain
 * after. Real deliverability is decided by whether the code arrives, so the
 * only job here is catching obvious typos before spending a network round trip
 * (and before Supabase counts it against the address's rate limit).
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(normalizeEmail(email));
}

/** True when the string is exactly the digits Supabase will accept. */
export function isValidOtp(token: string): boolean {
  return new RegExp(`^\\d{${EMAIL_OTP_LENGTH}}$`).test(token.trim());
}

/** Strip everything a user might paste around the code (spaces, dashes). */
export function normalizeOtp(token: string): string {
  return token.replace(/\D/g, "").slice(0, EMAIL_OTP_LENGTH);
}

/**
 * Turn whatever went wrong into something worth showing a person.
 *
 * Supabase reports OTP problems through a small set of codes, but older
 * releases and some edge paths only set `message`, so both are checked. A
 * TypeError from fetch is how every JS runtime reports "the request never
 * completed", which is the one case where retrying is genuinely the fix.
 */
export function describeAuthError(
  error: unknown,
  fallback: string = GENERIC_SESSION_FAILURE,
): string {
  if (!error) return fallback;

  // fetch() rejects with a TypeError when the request never reached a server.
  if (error instanceof TypeError) return NETWORK_FAILURE;

  const candidate = error as AuthErrorLike;
  const code = typeof candidate.code === "string" ? candidate.code : "";
  const message = typeof candidate.message === "string" ? candidate.message : "";
  const haystack = `${code} ${message}`.toLowerCase();

  const EXPIRED = `That code has expired. Request a new one and we'll email you a fresh ${EMAIL_OTP_LENGTH}-digit code.`;
  const INVALID_CODE = `That code doesn't look right. Check the ${EMAIL_OTP_LENGTH} digits and try again.`;
  const INVALID_OR_EXPIRED = `That code is invalid or has expired. Check the ${EMAIL_OTP_LENGTH} digits, or request a new code.`;
  const INVALID_EMAIL =
    "That email address doesn't look right. Please check it and try again.";
  // Deliberately vague on duration: the real floor depends on the project's
  // SMTP setup (Supabase's built-in service allows 2 messages/hour, a custom
  // provider 30/hour), so naming a number would be wrong in one case or both.
  const RATE_LIMITED =
    "Too many attempts. Please wait a few minutes before requesting another code.";
  const DISABLED =
    "Email sign-in is currently unavailable. Please try again later.";

  // Codes are checked before message text, and exhaustively, because
  // Supabase's combined "Token has expired or is invalid" wording matches
  // both readings — letting a substring decide would report a mistyped code
  // as an expired one and send the user to request a needless new email.
  switch (code) {
    case "otp_expired":
      return EXPIRED;
    case "invalid_credentials":
    case "otp_invalid":
      return INVALID_CODE;
    case "otp_disabled":
    case "email_provider_disabled":
    case "signup_disabled":
      return DISABLED;
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return RATE_LIMITED;
    case "validation_failed":
    case "email_address_invalid":
      return INVALID_EMAIL;
  }

  if (candidate.status === 429) return RATE_LIMITED;

  if (
    haystack.includes("failed to fetch") ||
    haystack.includes("network request failed") ||
    haystack.includes("networkerror")
  ) {
    return NETWORK_FAILURE;
  }

  // Only reached when no code was supplied; the ambiguous phrase gets wording
  // that is actionable either way.
  if (haystack.includes("expired or is invalid")) return INVALID_OR_EXPIRED;
  if (haystack.includes("expired")) return EXPIRED;
  if (haystack.includes("invalid token") || haystack.includes("otp")) {
    return INVALID_CODE;
  }
  if (haystack.includes("rate limit")) return RATE_LIMITED;
  if (
    haystack.includes("signups not allowed") ||
    haystack.includes("email logins are disabled")
  ) {
    return DISABLED;
  }
  if (
    haystack.includes("invalid email") ||
    haystack.includes("unable to validate email")
  ) {
    return INVALID_EMAIL;
  }

  return message || fallback;
}

/**
 * Step 1: ask Supabase to email a code.
 *
 * `shouldCreateUser` is left at Supabase's default (true) so a first-time
 * address is signed up by the same flow that signs an existing one in — there
 * is no separate registration screen in either app.
 */
export async function requestEmailOtp(
  auth: OtpAuthClient,
  rawEmail: string,
): Promise<AuthResult> {
  const email = normalizeEmail(rawEmail);

  if (!isValidEmail(email)) {
    return {
      ok: false,
      message: "Enter a valid email address, like you@example.com.",
    };
  }

  try {
    const { error } = await auth.signInWithOtp({ email });
    if (error) {
      return { ok: false, message: describeAuthError(error, GENERIC_SEND_FAILURE) };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, message: describeAuthError(error, GENERIC_SEND_FAILURE) };
  }
}

/**
 * Step 2: exchange the emailed code for a session.
 *
 * `type: "email"` is the OTP variant that pairs with signInWithOtp({ email });
 * "magiclink" is for the clicked-link token, which this flow never issues.
 * A success with no session means Supabase accepted the call but issued
 * nothing to store, which would otherwise strand the UI in a signed-in state
 * with no credentials — treated as a failure here.
 */
export async function verifyEmailOtp(
  auth: OtpAuthClient,
  rawEmail: string,
  rawToken: string,
): Promise<AuthResult> {
  const email = normalizeEmail(rawEmail);
  const token = normalizeOtp(rawToken);

  if (!isValidOtp(token)) {
    return {
      ok: false,
      message: `Enter the ${EMAIL_OTP_LENGTH}-digit code from your email.`,
    };
  }

  try {
    const { data, error } = await auth.verifyOtp({ email, token, type: "email" });
    if (error) {
      return {
        ok: false,
        message: describeAuthError(error, GENERIC_VERIFY_FAILURE),
      };
    }
    if (!data?.session) {
      return { ok: false, message: GENERIC_VERIFY_FAILURE };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: describeAuthError(error, GENERIC_VERIFY_FAILURE),
    };
  }
}

/**
 * Clearing the local session is what actually signs the user out of the app,
 * so a failure to reach Supabase still leaves them signed out locally. The
 * message is returned for surfacing, not for blocking the transition.
 */
export async function signOut(auth: OtpAuthClient): Promise<AuthResult> {
  try {
    const { error } = await auth.signOut();
    if (error) {
      return {
        ok: false,
        message: describeAuthError(error, GENERIC_SESSION_FAILURE),
      };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: describeAuthError(error, GENERIC_SESSION_FAILURE),
    };
  }
}


// ---------------------------------------------------------------------------
// Luna natural-language concert search (TEA-47)
// ---------------------------------------------------------------------------
//
// Both apps send a natural-language query to the same `concert-query` Supabase
// Edge Function and feed its structured output into the same /api/concerts
// route, so the interpretation flow, the location-retry handshake, and the
// user-facing error wording all belong in one place.
//
// What deliberately does NOT live here, following the same split as the auth
// helpers above: the Supabase client and the device-location API. Web invokes
// through a cookie-backed browser client and geolocates via
// navigator.geolocation; mobile invokes through an AsyncStorage-backed client
// and geolocates via expo-location. Both are passed in as parameters, typed
// structurally, so this module stays free of @supabase/supabase-js and of any
// browser-only or React-Native-only API — and every function here is testable
// against plain fakes.

/** Ticketmaster-compatible params the Edge Function emits. Mirrors
 *  `toTicketmasterParams` in supabase/functions/concert-query/handler.ts. */
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

/** Ticketmaster has no price parameter, so JamSpot applies these itself. */
export type ConcertPriceFilter = {
  minPrice?: number;
  maxPrice?: number;
  currency: "USD";
};

/** How the Edge Function decided where to search. */
export type LocationSource =
  | "query"
  | "device"
  | "caller-place"
  | "ip"
  | "nationwide";

export type ConcertQueryResponse = {
  query: string;
  interpretation?: string;
  ticketmasterParams: TicketmasterParams;
  filters?: ConcertPriceFilter;
  meta?: {
    model?: string;
    timeZone?: string;
    currentDateTime?: string;
    locationSource?: LocationSource;
  };
};

/** Device coordinates, however the platform obtained them. */
export type DeviceLocation = {
  latitude: number;
  longitude: number;
};

/** Extra field sent on the retry, once we know where (or whether) we can locate. */
export type ConcertQueryRetry =
  | { location: DeviceLocation }
  | { geolocationDenied: true };

export type ConcertQueryBody = {
  query: string;
  timeZone: string;
} & Partial<{ location: DeviceLocation; geolocationDenied: true }>;

/**
 * The one thing each platform supplies: a call to the Edge Function. Typed as
 * supabase-js's `functions.invoke` result so both apps can pass a thin wrapper
 * around their own client.
 */
export type ConcertQueryInvoker = (
  body: ConcertQueryBody,
) => Promise<{ data: unknown; error: unknown }>;

/**
 * Resolves device coordinates, or null when the platform can't or the user
 * declines. Web wraps navigator.geolocation; mobile wraps expo-location.
 */
export type DeviceLocationProvider = () => Promise<DeviceLocation | null>;

const CONCERT_QUERY_FAILURE = "Concert query failed.";
const INVALID_RESPONSE =
  "Concert query returned an invalid response.";

/**
 * Pull the message and machine-readable code out of whatever the Edge
 * Function invocation threw.
 *
 * Matched on `error.name` rather than `instanceof`, so this needs no
 * dependency on @supabase/supabase-js — the same structural approach the auth
 * helpers above take. `FunctionsHttpError` carries the response as `context`,
 * and the function's own `{ error, code }` body is inside it; the other two
 * classes have fixed messages and no body worth reading.
 */
export async function describeConcertQueryError(
  error: unknown,
): Promise<{ message: string; code?: string }> {
  if (!error) return { message: CONCERT_QUERY_FAILURE };

  const candidate = error as {
    name?: string;
    message?: string;
    context?: { json?: () => Promise<unknown> };
  };

  if (candidate.name === "FunctionsHttpError" && candidate.context?.json) {
    try {
      const payload = (await candidate.context.json()) as {
        error?: unknown;
        code?: unknown;
      };

      if (typeof payload?.error === "string") {
        return {
          message: payload.error,
          code: typeof payload.code === "string" ? payload.code : undefined,
        };
      }
    } catch {
      // Body wasn't JSON. Fall through to the error's own message.
    }
  }

  if (candidate.name === "FunctionsRelayError") {
    return {
      message: `Supabase relay error: ${candidate.message ?? "unknown"}`,
    };
  }

  if (candidate.name === "FunctionsFetchError") {
    return {
      message: `Unable to reach the concert query service: ${
        candidate.message ?? "unknown"
      }`,
    };
  }

  if (typeof candidate.message === "string" && candidate.message) {
    return { message: candidate.message };
  }

  return { message: CONCERT_QUERY_FAILURE };
}

/**
 * Turn a natural-language query into Ticketmaster search parameters.
 *
 * The first call deliberately carries no location: a query that names a city
 * needs none, and the Edge Function never learns where the user is unless it
 * asks. Only when it answers `location_required` do we ask the platform for
 * coordinates and try again — and if that comes back empty (permission
 * refused, unsupported, timed out), the retry says so and the function widens
 * to a nationwide search rather than leaving the user at a dead end.
 *
 * Throws an Error carrying a user-facing message; callers surface it directly.
 */
export async function interpretConcertQuery(
  invoke: ConcertQueryInvoker,
  query: string,
  timeZone: string,
  requestDeviceLocation: DeviceLocationProvider,
): Promise<ConcertQueryResponse> {
  async function call(extra?: ConcertQueryRetry) {
    const { data, error } = await invoke({ query, timeZone, ...extra });
    if (error) throw error;
    return data;
  }

  let data: unknown;

  try {
    data = await call();
  } catch (error) {
    const { message, code } = await describeConcertQueryError(error);

    if (code !== "location_required") {
      throw new Error(message);
    }

    const location = await requestDeviceLocation();

    try {
      data = await call(location ? { location } : { geolocationDenied: true });
    } catch (retryError) {
      // The retry's own failure is what the user needs to see - typically
      // `anchor_required`, which asks for an artist, genre, or place.
      throw new Error((await describeConcertQueryError(retryError)).message);
    }
  }

  if (!data || typeof data !== "object" || !("ticketmasterParams" in data)) {
    throw new Error(INVALID_RESPONSE);
  }

  return data as ConcertQueryResponse;
}

/**
 * Serialize the Edge Function's output into a query string for
 * /api/concerts, dropping anything empty. The route accepts these param
 * names verbatim, including the geolocated form (geoPoint + radius) and the
 * price bounds Ticketmaster itself can't filter on.
 */
export function buildConcertsQuery(
  params: TicketmasterParams,
  filters?: ConcertPriceFilter,
): string {
  const search = new URLSearchParams();

  const entries: Record<string, unknown> = {
    ...params,
    ...(filters?.minPrice !== undefined ? { minPrice: filters.minPrice } : {}),
    ...(filters?.maxPrice !== undefined ? { maxPrice: filters.maxPrice } : {}),
  };

  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  }

  return search.toString();
}

// ---------------------------------------------------------------------------
// One search field (TEA-51)
// ---------------------------------------------------------------------------
//
// Luna's field is the only search input either app has, so everything the two
// old fields used to express - a keyword, and a city or state - now arrives as
// one line of text. That makes this module responsible for deciding what a
// given line of text *is* before anything is spent on it:
//
//   1. A bare state ("TX", "Texas") is answered without Luna. There is no
//      natural language to interpret in it, so an OpenAI round trip would add
//      latency and cost to produce the `stateCode` we can already see.
//   2. Anything else goes to Luna, which decides whether it is a live-music
//      request at all (see SCOPE RULES in the Edge Function's instructions)
//      and turns it into Ticketmaster parameters.
//   3. Input that is not a search in either sense - blank, over-long, or
//      punctuation with no word in it - is refused here, before any network
//      call, with a message the caller shows the user.
//
// Both apps call resolveConcertSearch and get back a query string for
// /api/concerts, so the two clients cannot drift on which queries bypass Luna
// or on how a refusal is worded.

/** A US state (or DC) Ticketmaster will accept as a `stateCode`. */
export type UsState = {
  /** Two-letter code, uppercase - Ticketmaster's `stateCode`. */
  code: string;
  name: string;
};

/**
 * The 50 states plus the District of Columbia, which Ticketmaster treats as a
 * state code of its own. Territories are deliberately absent: Ticketmaster's
 * US coverage of them is thin enough that "PR" is far more likely to be a
 * typo or an artist's initials than a search for Puerto Rico.
 */
export const US_STATES: readonly UsState[] = [
  { code: "AL", name: "Alabama" },
  { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" },
  { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" },
  { code: "DE", name: "Delaware" },
  { code: "DC", name: "District of Columbia" },
  { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" },
  { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
];

/**
 * Spellings that are unambiguously one state but are neither its code nor its
 * full name. "Washington DC" is the important one: without it, the capital
 * would resolve to Washington state, 2,700 miles away.
 */
const STATE_ALIASES: Readonly<Record<string, string>> = {
  "washington dc": "DC",
  "district of columbia": "DC",
  "washington district of columbia": "DC",
};

/**
 * Lowercased, punctuation-free, single-spaced - so "  new  york. " and
 * "New York" are the same lookup key, and "D.C." matches "dc".
 */
function stateLookupKey(value: string): string {
  return value
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * The state the whole query names, or null.
 *
 * Deliberately an exact match against the entire input rather than a search
 * within it: "Texas" is a request for shows in Texas, but "Texas Hippie
 * Coalition" is a band and "shows in Texas next month" carries a date Luna
 * needs to read. Only a query that is nothing but a state can skip Luna.
 *
 * Two-letter codes are matched the same way, which means a query of exactly
 * "OR", "IN", or "OK" is read as Oregon, Indiana, and Oklahoma rather than as
 * an English word. On a field whose entire content is those two letters,
 * that is the reading that produces results.
 */
export function resolveStateQuery(raw: string): UsState | null {
  const key = stateLookupKey(raw);

  if (!key) return null;

  const aliased = STATE_ALIASES[key];

  if (aliased) {
    return US_STATES.find((state) => state.code === aliased) ?? null;
  }

  return (
    US_STATES.find(
      (state) =>
        key === state.code.toLowerCase() || key === state.name.toLowerCase(),
    ) ?? null
  );
}

/**
 * Longest query the Edge Function accepts. Enforced here too so an over-long
 * query is refused in the field rather than after a round trip.
 */
export const MAX_SEARCH_QUERY_LENGTH = 500;

const EMPTY_QUERY_MESSAGE =
  "Search for a show — an artist, a genre, a city, or a state.";
const LONG_QUERY_MESSAGE =
  `Keep your search to ${MAX_SEARCH_QUERY_LENGTH} characters or fewer.`;
const UNSEARCHABLE_QUERY_MESSAGE =
  "That isn't something JamSpot can search. Try an artist, a genre, a city, or a state.";

/** What a line of text in the search field turns out to be. */
export type SearchIntent =
  /** A bare state: answered straight from Ticketmaster, no Luna involved. */
  | { kind: "state"; query: string; state: UsState }
  /** Natural language: Luna interprets it and decides whether it's in scope. */
  | { kind: "luna"; query: string }
  /** Not a search at all. `message` is written for the user. */
  | { kind: "rejected"; query: string; message: string };

/**
 * First of the two scope gates a query passes before anything reaches
 * Ticketmaster. This one is structural and runs in the client: it refuses
 * input that cannot be a search whatever it means - nothing typed, more text
 * than the function accepts, or punctuation with no word in it.
 *
 * The second gate is Luna itself, which judges whether the words describe a
 * live-music search and refuses the ones that don't (`out_of_scope`). It has
 * to be the model's call: no pattern here can tell "something loud tonight"
 * from "what's the weather tonight".
 *
 * A query that resolves to a state skips the second gate, and correctly so -
 * a state is a Ticketmaster search parameter, not a question.
 */
export function classifySearchQuery(raw: string): SearchIntent {
  const query = raw.replace(/\s+/g, " ").trim();

  if (!query) {
    return { kind: "rejected", query, message: EMPTY_QUERY_MESSAGE };
  }

  if (query.length > MAX_SEARCH_QUERY_LENGTH) {
    return { kind: "rejected", query, message: LONG_QUERY_MESSAGE };
  }

  // Strip ASCII punctuation and whitespace; anything left is a word, in any
  // script. Written as explicit ranges rather than a \p{...} class so it runs
  // identically on Hermes, which has no Unicode property escapes.
  if (!query.replace(/[\s!-/:-@[-`{-~]+/g, "")) {
    return { kind: "rejected", query, message: UNSEARCHABLE_QUERY_MESSAGE };
  }

  const state = resolveStateQuery(query);

  if (state) {
    return { kind: "state", query, state };
  }

  return { kind: "luna", query };
}

/**
 * The Ticketmaster search a bare state name means: every music event in that
 * state, soonest first.
 *
 * `countryCode` is pinned because state codes are not globally unique -
 * without it, "WA" is Washington and Western Australia both.
 */
export function stateSearchParams(state: UsState): TicketmasterParams {
  return {
    stateCode: state.code,
    countryCode: "US",
    classificationName: "music",
    sort: "date,asc",
  };
}

/** The line shown above the results for a state search, in place of Luna's. */
export function describeStateSearch(state: UsState): string {
  return `Upcoming live music across ${state.name}.`;
}

export type ResolvedConcertSearch = {
  /** Query string for /api/concerts, ready to fetch. */
  search: string;
  /** One sentence describing the search, shown above the results. */
  interpretation?: string;
  /** Which path produced it - a bare state, or Luna. */
  source: "state" | "luna";
};

/**
 * Turn whatever is in the search field into a /api/concerts query string.
 *
 * Everything up to (but not including) the concert request lives here, so the
 * two apps share the bypass rule, the scope refusals, and Luna's
 * location-retry handshake, and differ only in how they fetch.
 *
 * Throws an Error whose message is written for the user: a refused query, an
 * out-of-scope one, or a Luna failure. Callers surface it directly.
 */
export async function resolveConcertSearch(
  raw: string,
  timeZone: string,
  invoke: ConcertQueryInvoker,
  requestDeviceLocation: DeviceLocationProvider,
): Promise<ResolvedConcertSearch> {
  const intent = classifySearchQuery(raw);

  if (intent.kind === "rejected") {
    throw new Error(intent.message);
  }

  if (intent.kind === "state") {
    return {
      search: buildConcertsQuery(stateSearchParams(intent.state)),
      interpretation: describeStateSearch(intent.state),
      source: "state",
    };
  }

  const result = await interpretConcertQuery(
    invoke,
    intent.query,
    timeZone,
    requestDeviceLocation,
  );

  return {
    search: buildConcertsQuery(result.ticketmasterParams, result.filters),
    interpretation: result.interpretation,
    source: "luna",
  };
}
