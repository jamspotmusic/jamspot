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
  venue: string | null;
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
 * Row shape of the `reviews` table.
 *
 * There is no `user_id` / accounts table - JamSpot has no authentication.
 * `user_name` is a plain, manually-entered text field, not a foreign key.
 *
 * Source of truth was apps/web/lib/reviews.ts.
 */
export type Review = {
  id: string;
  musician: string;
  venue: string;
  concert_date: string; // ISO date, e.g. "2026-05-01"
  review_text: string;
  venue_city: string | null;
  venue_state: string | null;
  venue_country: string | null;
  user_name: string | null;
  created_at: string;
};

/** Fields needed to create a new review. */
export type NewReview = {
  musician: string;
  venue: string;
  concertDate: string;
  reviewText: string;
  venueCity?: string;
  venueState?: string;
  venueCountry?: string;
  userName?: string;
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
