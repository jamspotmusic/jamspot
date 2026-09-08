import type * as LocationModule from 'expo-location';

import type { ConcertQueryBody, DeviceLocation } from '@jamspot/shared';

import { supabase } from '@/lib/supabase';

/**
 * Load expo-location only when a search actually needs coordinates.
 *
 * The module cannot be imported at the top of this file. expo-location
 * resolves its native counterpart at module scope
 * (`requireNativeModule('ExpoLocation')` in its build/ExpoLocation.js), so on
 * a binary that predates the dependency the import throws while this module is
 * still evaluating - long before requestDeviceLocation's own try/catch can run.
 * That failure propagates through components/luna-search.tsx into app/index.tsx,
 * which then finishes evaluation with no default export and takes the whole
 * route down ("Route ./index.tsx is missing the required default export").
 *
 * Deferring it to call time keeps that failure inside the one function
 * equipped to handle it, where "no native module" joins the other ways a
 * device can decline to say where it is.
 */
function loadLocation(): typeof LocationModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-location') as typeof LocationModule;
  } catch {
    return null;
  }
}

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
 * Ask the device for coordinates, resolving null when we can't have them.
 *
 * Null covers every "no location" case the shared flow treats alike -
 * permission refused, services switched off, the fix taking too long, or the
 * running binary having no ExpoLocation module linked at all - and it responds
 * by telling the Edge Function so, which widens the search nationwide instead
 * of leaving the user stuck.
 *
 * `requestForegroundPermissionsAsync` shows the OS prompt the first time and
 * returns the remembered answer afterwards, so this is safe to call on every
 * search. Balanced accuracy is deliberate: a concert search is scoped in tens
 * of miles, and asking for the highest accuracy would spin up GPS and cost
 * seconds and battery for precision the radius makes irrelevant.
 */
export async function requestDeviceLocation(): Promise<DeviceLocation | null> {
  const Location = loadLocation();
  if (!Location) return null;

  try {
    const { granted } = await Location.requestForegroundPermissionsAsync();
    if (!granted) return null;

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

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