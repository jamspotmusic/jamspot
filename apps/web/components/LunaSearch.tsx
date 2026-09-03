"use client";

import { useState, type FormEvent } from "react";
import { Sparkles } from "lucide-react";
import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase";
import type { NormalizedConcert } from "@/lib/ticketmaster";

/**
 * Matches the Ticketmaster-compatible params the `concert-query` Edge
 * Function returns - see supabase/functions/concert-query/handler.ts
 * (`toTicketmasterParams`). Kept in sync with, but separate from, that
 * file since one is Deno/server-side and this is the browser client.
 */
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
export type PriceFilter = {
  minPrice?: number;
  maxPrice?: number;
  currency: "USD";
};

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
  filters?: PriceFilter;
  meta?: {
    model?: string;
    timeZone?: string;
    currentDateTime?: string;
    locationSource?: LocationSource;
  };
};

export type DeviceLocation = {
  latitude: number;
  longitude: number;
};

/** Builds the same /api/concerts query the structured search already uses. */
export function buildConcertsUrl(
  params: TicketmasterParams,
  filters?: PriceFilter,
): string {
  const searchParams = new URLSearchParams();

  for (
    const [key, value] of Object.entries({
      ...params,
      ...(filters?.minPrice !== undefined ? { minPrice: filters.minPrice } : {}),
      ...(filters?.maxPrice !== undefined ? { maxPrice: filters.maxPrice } : {}),
    })
  ) {
    if (value !== undefined && value !== null && value !== "") {
      searchParams.set(key, String(value));
    }
  }

  return `/api/concerts?${searchParams.toString()}`;
}

/**
 * The Edge Function returns a `code` alongside its message. `location_required`
 * is the one worth acting on: the search only makes sense somewhere, and
 * nobody has told the function where that is yet.
 */
export async function getFunctionError(
  error: unknown,
): Promise<{ message: string; code?: string }> {
  if (error instanceof FunctionsHttpError) {
    try {
      const payload = (await error.context.json()) as {
        error?: unknown;
        code?: unknown;
      };

      if (typeof payload.error === "string") {
        return {
          message: payload.error,
          code: typeof payload.code === "string" ? payload.code : undefined,
        };
      }
    } catch {
      return { message: error.message };
    }
  }

  if (error instanceof FunctionsRelayError) {
    return { message: `Supabase relay error: ${error.message}` };
  }

  if (error instanceof FunctionsFetchError) {
    return {
      message: `Unable to reach Supabase Edge Function: ${error.message}`,
    };
  }

  if (error instanceof Error) {
    return { message: error.message };
  }

  return { message: "Concert query failed." };
}

/** Resolves to null when the browser has no geolocation or the user declines. */
export function requestDeviceLocation(): Promise<DeviceLocation | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }),
      () => resolve(null),
      { timeout: 10_000, maximumAge: 5 * 60_000 },
    );
  });
}

/**
 * Calls the `concert-query` Supabase Edge Function, retrying once with a
 * device location if (and only if) the function reports it needs one. The
 * client only ever talks to Supabase here - the Edge Function is what holds
 * the OpenAI credential, server-side, so it never reaches the browser.
 */
export async function interpretQuery(
  query: string,
  timeZone: string,
): Promise<ConcertQueryResponse> {
  async function invoke(
    extra?: { location: DeviceLocation } | { geolocationDenied: true },
  ) {
    const { data, error } = await supabase.functions.invoke("concert-query", {
      body: { query, timeZone, ...extra },
    });

    if (error) throw error;
    return data;
  }

  let data: unknown;

  try {
    data = await invoke();
  } catch (error) {
    const { message, code } = await getFunctionError(error);

    if (code !== "location_required") {
      throw new Error(message);
    }

    const location = await requestDeviceLocation();

    // Permission refused, unsupported, or timed out. Say so on the retry and
    // the function widens to a nationwide search instead of asking again.
    data = await invoke(
      location ? { location } : { geolocationDenied: true },
    ).catch(async (retryError) => {
      throw new Error((await getFunctionError(retryError)).message);
    });
  }

  if (!data || typeof data !== "object" || !("ticketmasterParams" in data)) {
    throw new Error("Concert query returned an invalid response.");
  }

  return data as ConcertQueryResponse;
}

export default function LunaSearch({
  onSearchStart,
  onSearchSuccess,
  onSearchError,
}: {
  /** Called right before the Ticketmaster request begins, so the caller can
   *  reset its own search/filter state and show a loading state. */
  onSearchStart: () => void;
  /** Called with the normalized concerts once Ticketmaster responds. */
  onSearchSuccess: (concerts: NormalizedConcert[]) => void;
  /** Called with a user-facing message if interpreting or searching fails. */
  onSearchError: (message: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [isInterpreting, setIsInterpreting] = useState(false);
  const [interpretError, setInterpretError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = query.trim();

    if (!trimmed) {
      setInterpretError("Describe the kind of show you're looking for.");
      return;
    }

    setIsInterpreting(true);
    setInterpretError(null);

    let result: ConcertQueryResponse;

    try {
      const timeZone =
        Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

      result = await interpretQuery(trimmed, timeZone);
    } catch (error) {
      setIsInterpreting(false);
      setInterpretError(
        error instanceof Error ? error.message : "Concert query failed.",
      );
      return;
    }

    setIsInterpreting(false);
    // Hand off to the existing concert search flow: same /api/concerts
    // route, same result shape, same grid the structured search renders.
    onSearchStart();

    try {
      const url = buildConcertsUrl(result.ticketmasterParams, result.filters);
      const response = await fetch(url);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : `Concert search failed (${response.status})`,
        );
      }

      onSearchSuccess((data.concerts ?? []) as NormalizedConcert[]);
    } catch (error) {
      onSearchError(
        error instanceof Error ? error.message : "Failed to load concerts",
      );
    }
  }

  return (
    <div className="mx-auto w-full max-w-xl">
      <form
        onSubmit={handleSubmit}
        autoComplete="off"
        className="flex w-full flex-col gap-2 sm:flex-row sm:items-center"
      >
        <div className="flex flex-1 items-center gap-2 rounded-lg border border-white/20 bg-black/40 px-4 py-3 backdrop-blur-sm transition-colors focus-within:border-primary/60">
          <Sparkles size={16} className="shrink-0 text-primary" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask Luna: chill jazz shows under $60 this weekend..."
            className="w-full flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/50"
          />
        </div>

        <button
          type="submit"
          disabled={isInterpreting}
          className="shrink-0 cursor-pointer rounded-lg bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isInterpreting ? "Asking Luna..." : "Ask Luna"}
        </button>
      </form>

      {interpretError && (
        <p className="mt-2 text-sm text-red-300">{interpretError}</p>
      )}
    </div>
  );
}