import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client for authentication.
 *
 * Separate from lib/supabase.ts on purpose. That one is a plain
 * `createClient` used for anonymous data reads (lib/reviews.ts) and Edge
 * Function invocation, and it has no session to manage. This one writes the
 * session to cookies rather than localStorage, which is what lets a Server
 * Component read it (see lib/supabase-server.ts) — the reason @supabase/ssr
 * exists, and the reason the deprecated @supabase/auth-helpers-nextjs
 * packages are not used here.
 *
 * Only the project URL and the publishable (anon) key are read. Both are
 * NEXT_PUBLIC_* and therefore inlined into the browser bundle by design; they
 * confer no privilege beyond what Row Level Security allows. A service-role
 * key must never be referenced from this file or anything it imports.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
}

if (!supabasePublishableKey) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
}

/**
 * `createBrowserClient` memoizes internally, so calling this per component is
 * fine and avoids a module-level singleton that would be constructed during
 * SSR of any file that imports it.
 */
export function createClient() {
  return createBrowserClient(supabaseUrl!, supabasePublishableKey!);
}
