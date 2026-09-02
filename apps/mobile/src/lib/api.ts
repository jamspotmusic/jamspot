import Constants from 'expo-constants';

/**
 * Shape of a row from the live `reviews` table, as actually returned by
 * GET /api/reviews today. This intentionally does NOT reuse the `Review`
 * type from @jamspot/shared: that type (and apps/web/lib/reviews.ts) still
 * describe an older schema (musician/venue/review_text/...) that no longer
 * matches the database, which now has star ratings and an author_id/profiles
 * relation. Once the shared type and web backend are reconciled with the
 * live schema, this can go back to importing from @jamspot/shared.
 */
export type Review = {
  id: string;
  short_description: string;
  description: string;
  star_rating: number;
  location: string;
  review_date: string;
  created_at: string;
  updated_at: string;
  author_id: string;
  profiles: { username?: string; display_name?: string } | null;
};

/**
 * Production: jamspotmusic.app, served from Vercel through Cloudflare. The
 * `www` host is deliberate - the apex 308-redirects there, and while fetch
 * follows that, it costs a round trip on every single request.
 *
 * `extra.apiUrl` in app.json is the configurable version of this, so a build
 * can be pointed at subprod (https://jamspot-three.vercel.app) or anywhere
 * else without touching source.
 */
const DEPLOYED_API_URL = 'https://www.jamspotmusic.app';

/** How long to wait on the local dev server before giving up on it. */
const DEV_SERVER_PROBE_TIMEOUT_MS = 2000;

function getDeployedApiUrl(): string {
  const configured = Constants.expoConfig?.extra?.apiUrl;
  return typeof configured === 'string' && configured ? configured : DEPLOYED_API_URL;
}

/**
 * The machine running `npm run dev:web`, or null when there can't be one.
 * Metro's hostUri (e.g. "192.168.1.88:8081") names it, so simulators,
 * emulators, and physical devices on the same LAN all resolve the right host
 * without per-platform special-casing. A release build has no Metro server,
 * hence the `__DEV__` and hostUri guards: an unguarded `http://localhost:3000`
 * would point a shipped app at the handset it's running on.
 */
function getLocalDevApiUrl(): string | null {
  if (!__DEV__) return null;
  const hostUri = Constants.expoConfig?.hostUri;
  return hostUri ? `http://${hostUri.split(':')[0]}:3000` : null;
}

/**
 * Is a JamSpot dev server actually answering on `baseUrl`?
 *
 * Deliberately stricter than "something responded". Port 3000 is popular -
 * Grafana, other Next apps, whatever else - and a stray 404 from an unrelated
 * service is exactly how this app ends up rendering someone else's error. A
 * JamSpot route either succeeds or returns its own `{ error }` shape, so
 * anything else means we're talking to a stranger and should ignore it.
 */
async function isJamSpotDevServer(baseUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEV_SERVER_PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/api/reviews`, { signal: controller.signal });
    if (response.ok) return true;
    const body = await response.json().catch(() => null);
    return typeof body?.error === 'string';
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The web app's API routes are the backend for both clients. Resolved in
 * descending order of specificity:
 *
 *  1. `EXPO_PUBLIC_API_URL`, an explicit override, which wins everywhere.
 *  2. In a dev build, the local dev server - but only if it's actually up.
 *  3. Otherwise the deployed web app over https.
 *
 * Case 2 is a preference, not a requirement. Working on mobile shouldn't mean
 * running the web app too, so a dev build with no dev server behind it falls
 * through to the deployed API and keeps working. Start `npm run dev:web` and
 * reload to pick it back up - that ordering means unreleased API changes are
 * still testable, without the dev server being a prerequisite for the app to
 * show anything at all.
 */
async function resolveApiBaseUrl(): Promise<string> {
  const override = process.env.EXPO_PUBLIC_API_URL;
  if (override) return override;

  const local = getLocalDevApiUrl();
  if (local && (await isJamSpotDevServer(local))) {
    return local;
  }

  return getDeployedApiUrl();
}

/**
 * Resolved once per app session: the probe costs a round trip, and the answer
 * doesn't change while the app is running. Memoizing the promise rather than
 * the value collapses concurrent first calls - the three artist lookups the
 * details modal fires together - into a single probe.
 */
let apiBaseUrlPromise: Promise<string> | null = null;

function getApiBaseUrl(): Promise<string> {
  apiBaseUrlPromise ??= resolveApiBaseUrl();
  return apiBaseUrlPromise;
}

export class ApiError extends Error {}

export async function apiFetch<T>(path: string): Promise<T> {
  const url = `${await getApiBaseUrl()}${path}`;
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    // Suggesting the dev server only makes sense when we're pointed at one.
    // The local branch is the only one that resolves to plain http, so a
    // release build talking to the deployed API doesn't get told to go start
    // something on their laptop.
    const hint = url.startsWith('http://') ? ' Is "npm run dev:web" running?' : '';
    throw new ApiError(`Could not reach the JamSpot API at ${url}.${hint}`);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    // The URL, not just the path: when something other than the JamSpot API
    // is answering on this port, the host is the whole story.
    throw new ApiError(body?.error ?? `Request to ${url} failed with status ${response.status}`);
  }
  return response.json();
}

export async function getReviews(): Promise<Review[]> {
  const { reviews } = await apiFetch<{ reviews: Review[] }>('/api/reviews');
  return reviews;
}
