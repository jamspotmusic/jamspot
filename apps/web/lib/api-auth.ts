import { createClient as createSupabaseClient, type SupabaseClient, type User } from "@supabase/supabase-js";

import { createClient as createCookieClient } from "@/lib/supabase-server";

/**
 * Resolving "who is making this request" for the review API routes.
 *
 * Two clients authenticate two different ways against the same Supabase
 * project, and both have to work against the same routes:
 *
 *   * apps/web signs in through @supabase/ssr, which persists the session in
 *     cookies the Route Handler can read.
 *   * apps/mobile has no cookie jar. It holds the session in AsyncStorage and
 *     sends the access token as `Authorization: Bearer <jwt>`.
 *
 * The returned client matters as much as the returned user. Every write goes
 * through a client carrying that user's JWT, so Row Level Security evaluates
 * `auth.uid()` as them. Nothing here uses a service-role key: the routes have
 * no authority the signed-in user does not already have, which means a bug in
 * an ownership check cannot become a way to edit somebody else's review - the
 * database would still refuse it.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export type RequestIdentity = {
  user: User;
  /** Acts as `user`; RLS applies to everything done through it. */
  supabase: SupabaseClient;
};

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

/**
 * The authenticated user behind this request, or null.
 *
 * `getUser()` is used rather than `getSession()` in both branches: getSession
 * trusts whatever the cookie or header says, while getUser revalidates the
 * token against the Auth server. Only the second is a safe basis for deciding
 * who owns a row.
 */
export async function resolveRequestIdentity(request: Request): Promise<RequestIdentity | null> {
  const token = bearerToken(request);

  if (token) {
    const supabase = createSupabaseClient(supabaseUrl!, supabasePublishableKey!, {
      // The token travels on every request this client makes, which is what
      // makes RLS see the caller rather than an anonymous visitor.
      global: { headers: { Authorization: `Bearer ${token}` } },
      // A Route Handler is stateless and shared between requests; persisting
      // or refreshing a session here would leak one caller's token into the
      // next caller's client.
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return null;
    return { user: data.user, supabase };
  }

  const supabase = await createCookieClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { user: data.user, supabase };
}

/**
 * The display name to stamp on a review, derived from the session - never
 * from the request body.
 *
 * Preference order is the profile's username, then the local part of the
 * account's email, then a constant. The fallbacks exist because `user_name` is
 * NOT NULL and non-blank in the database: a user who never created a profile
 * row must still be able to post, rather than hitting a constraint error they
 * cannot do anything about.
 */
export async function resolveDisplayName(identity: RequestIdentity): Promise<string> {
  const { data } = await identity.supabase
    .from("profiles")
    .select("username")
    .eq("id", identity.user.id)
    .maybeSingle();

  const username = typeof data?.username === "string" ? data.username.trim() : "";
  if (username) return username;

  const emailLocalPart = (identity.user.email ?? "").split("@")[0].trim();
  if (emailLocalPart) return emailLocalPart;

  return "JamSpot listener";
}
