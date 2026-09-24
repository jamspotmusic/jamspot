// Type-only, so nothing is imported at runtime. expo-location resolves its
// native module at *module scope*, which means a plain `import` of it throws
// during import on a build that doesn't have ExpoLocation compiled in - taking
// the whole route down with it, long before any try/catch here could run.
// loadLocation() below defers that to the one moment it is actually needed.
import type * as ExpoLocation from 'expo-location';

import type { ConcertQueryBody, DeviceLocation } from '@jamspot/shared';

import { supabase } from '@/lib/supabase';

/**
 * Invoke the `concert-query` Edge Function.
 *
 * Goes through the same Supabase client the mobile app already uses for auth
 * (src/lib/supabase.ts), so the OpenAI credential stays server-side in the
 * function's own env and is never bundled into the app.
 */
export async function invokeConcertQuery(body: ConcertQueryBody) {
  return supabase.functions.invoke('concert-query', { body });
}

/**
 * How long to wait for a position before giving up on one.
 *
 * `getCurrentPositionAsync` has no timeout of its own and does not have to
 * settle: a device with location services on, permission granted, and no fix
 * available leaves the promise pending indefinitely - which is the normal
 * state of a simulator with no simulated position. Without this, that hangs
 * the search rather than falling back to a nationwide one.
 */
const LOCATION_TIMEOUT_MS = 8000;

let warnedAboutMissingModule = false;

/**
 * expo-location, or null on a build that has no ExpoLocation native module.
 *
 * That happens when the native project is older than the dependency - the
 * JS bundle has expo-location in it, the installed app does not, and only a
 * rebuild (`npm run android` / `npm run ios`) puts it there. Treating that as
 * "no location available" keeps the app usable in the meantime; the warning is
 * so it doesn't look like the user simply declined the permission prompt.
 */
async function loadLocation(): Promise<typeof ExpoLocation | null> {
  try {
    return await import('expo-location');
  } catch {
    if (!warnedAboutMissingModule) {
      warnedAboutMissingModule = true;
      console.warn(
        'expo-location is missing from this build, so JamSpot cannot search ' +
          'near you. Rebuild the app to include it. Searches that name no ' +
          'place will run nationwide until then.',
      );
    }

    return null;
  }
}

/**
 * Ask the device for coordinates, resolving null when we can't have them.
 *
 * Null covers every "no location" case the shared flow treats alike -
 * permission refused, services switched off, the fix taking too long, or the
 * native module not being in this build at all - and it responds by telling
 * the Edge Function so, which widens the search nationwide instead of leaving
 * the user stuck.
 *
 * `requestForegroundPermissionsAsync` shows the OS prompt the first time and
 * returns the remembered answer afterwards, so this is safe to call on every
 * search. Balanced accuracy is deliberate: a concert search is scoped in tens
 * of miles, and asking for the highest accuracy would spin up GPS and cost
 * seconds and battery for precision the radius makes irrelevant.
 */
export async function requestDeviceLocation(): Promise<DeviceLocation | null> {
  try {
    const Location = await loadLocation();
    if (!Location) return null;

    const { granted } = await Location.requestForegroundPermissionsAsync();
    if (!granted) return null;

    const position = await Promise.race([
      Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      }),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), LOCATION_TIMEOUT_MS);
      }),
    ]);

    if (!position) return null;

    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    };
  } catch {
    // Location services disabled, no fix available, or the module threw.
    // Indistinguishable from a refusal as far as the search is concerned.
    return null;
  }
}