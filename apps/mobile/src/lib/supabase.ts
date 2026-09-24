import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { AppState, Platform } from "react-native";

/**
 * Supabase client for the mobile app.
 *
 * Points at the SAME Supabase project as apps/web, so both clients share one
 * Auth user population — an account created by emailing a code on the phone
 * signs in on the web with the same address. What differs is session storage,
 * which is why this is a separate client rather than something imported from
 * apps/web: the web writes cookies via @supabase/ssr so Server Components can
 * read them, while React Native has no cookie jar and persists to AsyncStorage
 * instead.
 *
 * Only the project URL and publishable (anon) key are read, both EXPO_PUBLIC_*
 * and therefore embedded in the app bundle by design. They confer no privilege
 * beyond what Row Level Security allows. A service-role key, database
 * password, or JWT secret must never appear here — anything bundled into a
 * mobile app is readable by anyone who downloads it.
 */

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl) {
  throw new Error(
    "Missing EXPO_PUBLIC_SUPABASE_URL. Copy apps/mobile/.env.example to apps/mobile/.env and fill it in.",
  );
}

if (!supabasePublishableKey) {
  throw new Error(
    "Missing EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY. Copy apps/mobile/.env.example to apps/mobile/.env and fill it in.",
  );
}

/**
 * On native this is always AsyncStorage. On the Expo web target it is left
 * undefined during Expo Router's static render: that pass runs in Node, where
 * AsyncStorage's web implementation reaches for window.localStorage and throws
 * before a single route can be prerendered. supabase-js falls back to
 * in-memory storage there, which is correct for a render with no user, and the
 * browser picks AsyncStorage back up on hydration.
 */
const isServerRender = Platform.OS === "web" && typeof window === "undefined";

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    storage: isServerRender ? undefined : AsyncStorage,
    // Keep the session across app restarts.
    persistSession: true,
    // Refresh the access token before it expires.
    autoRefreshToken: true,
    // No URL to parse a session out of: there is no OAuth/magic-link redirect
    // in this flow, and leaving it on makes supabase-js touch window.location,
    // which does not exist in React Native.
    detectSessionInUrl: false,
  },
});

/**
 * Supabase's own React Native guidance: the auto-refresh timer must not run
 * while the app is backgrounded, or the OS suspends it mid-cycle and the
 * session can lapse. Start it on foreground, stop it otherwise.
 *
 * Registered once at module scope rather than in a component so it survives
 * remounts and can't be double-subscribed.
 */
if (!isServerRender) {
  AppState.addEventListener("change", (state) => {
    if (state === "active") {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
