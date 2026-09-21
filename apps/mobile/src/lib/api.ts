import Constants from 'expo-constants';
import type { NewReview, Review, ReviewFieldError, ReviewUpdate } from '@jamspot/shared';

import { supabase } from '@/lib/supabase';

/**
 * Reviews now come from @jamspot/shared, which the database, the web app, and
 * this app all agree on. (They used to diverge: the table had
 * short_description/star_rating/author_id while the shared type still
 * described musician/venue/review_text. The authenticated-reviews migration
 * reconciled all three, so the local duplicate this file used to carry is
 * gone.)
 */
export type { Review };

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

export class ApiError extends Error {
  readonly status: number;
  /** Per-field messages when the API rejected the input; empty otherwise. */
  readonly fields: ReviewFieldError[];

  constructor(message: string, status = 0, fields: ReviewFieldError[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.fields = fields;
  }

  /** True when signing in (or signing in again) is what would fix this. */
  get isAuthError() {
    return this.status === 401;
  }
}

type FetchOptions = {
  method?: string;
  body?: unknown;
  /** Attach the signed-in user's access token. Required for every write. */
  authenticated?: boolean;
};

/**
 * There is no cookie jar in React Native, so the session travels as a bearer
 * token instead - the transport apps/web/lib/api-auth.ts accepts alongside its
 * own cookie session. The token is read per request rather than cached, so a
 * refresh that happened since the screen mounted is picked up.
 */
async function authorizationHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new ApiError('You must be signed in to do that.', 401);
  }
  return { Authorization: `Bearer ${token}` };
}

export async function apiFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const url = `${await getApiBaseUrl()}${path}`;
  const headers: Record<string, string> = {};

  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.authenticated) Object.assign(headers, await authorizationHeader());

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
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
    throw new ApiError(
      body?.error ?? `Request to ${url} failed with status ${response.status}`,
      response.status,
      Array.isArray(body?.fields) ? body.fields : [],
    );
  }
  // 204s carry no body; everything this app calls returns JSON, but be safe.
  return response.status === 204 ? (undefined as T) : response.json();
}

export async function getReviews(): Promise<Review[]> {
  const { reviews } = await apiFetch<{ reviews: Review[] }>('/api/reviews');
  return reviews;
}

/**
 * The three writes. Each requires a signed-in user, and the server decides
 * ownership from that session - these never send a user id, and the API would
 * reject one if they did.
 */
export async function createReview(input: NewReview): Promise<Review> {
  const { review } = await apiFetch<{ review: Review }>('/api/reviews', {
    method: 'POST',
    body: input,
    authenticated: true,
  });
  return review;
}

export async function updateReview(id: string, input: ReviewUpdate): Promise<Review> {
  const { review } = await apiFetch<{ review: Review }>(`/api/reviews/${id}`, {
    method: 'PATCH',
    body: input,
    authenticated: true,
  });
  return review;
}

export async function deleteReview(id: string): Promise<void> {
  await apiFetch(`/api/reviews/${id}`, { method: 'DELETE', authenticated: true });
}
