import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * Server-side Supabase client, for reading the signed-in user inside Server
 * Components, Route Handlers, and Server Actions.
 *
 * The session lives in cookies written by lib/supabase-browser.ts, so this
 * reads the same session the browser holds. Only the publishable key is used:
 * requests made through this client are still governed by Row Level Security
 * exactly as the browser's are. It is not a privileged escape hatch, and no
 * service-role key belongs here.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
}

if (!supabasePublishableKey) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
}

export async function createClient() {
  // Next 15+ made cookies() async; this app is on Next 16.
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl!, supabasePublishableKey!, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. Supabase's own guidance is
          // to swallow this: the browser client refreshes the session on its
          // own, so a read-only render losing a refreshed token is harmless.
        }
      },
    },
  });
}

/**
 * The current user, or null.
 *
 * Uses getUser() rather than getSession(): getSession() trusts whatever is in
 * the cookie, while getUser() revalidates it against the Auth server, which is
 * the only safe basis for a server-side decision.
 */
export async function getServerUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
