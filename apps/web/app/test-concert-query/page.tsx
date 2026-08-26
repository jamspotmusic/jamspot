"use client";

import {
  useState,
  type FormEvent,
} from "react";

import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase";

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

const LOCATION_SOURCE_LABELS: Record<LocationSource, string> = {
  query: "The user named a place, so no geolocation was needed.",
  device:
    "No place was named, so JamSpot used this device's coordinates.",
  "caller-place":
    "No place was named, so JamSpot used the location the client already had.",
  ip: "No place was named, so JamSpot used the edge network's approximate location.",
  nationwide:
    "No place was named and this device would not share one, so the search is nationwide.",
};

export function buildConcertsUrl(
  params: TicketmasterParams,
  filters?: PriceFilter,
): string {
  const searchParams = new URLSearchParams();

  for (
    const [key, value] of Object.entries({
      ...params,
      ...(filters?.minPrice !== undefined
        ? { minPrice: filters.minPrice }
        : {}),
      ...(filters?.maxPrice !== undefined
        ? { maxPrice: filters.maxPrice }
        : {}),
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
 * is the one worth acting on: the query only makes sense somewhere, and nobody
 * has told the function where that is yet.
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
          code: typeof payload.code === "string"
            ? payload.code
            : undefined,
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
      message:
        `Unable to reach Supabase Edge Function: ${error.message}`,
    };
  }

  if (error instanceof Error) {
    return { message: error.message };
  }

  return { message: "Concert query failed." };
}

export async function getFunctionErrorMessage(
  error: unknown,
): Promise<string> {
  return (await getFunctionError(error)).message;
}

/** Resolves to null when the browser has no geolocation or the user declines. */
export function requestDeviceLocation(): Promise<DeviceLocation | null> {
  if (
    typeof navigator === "undefined" ||
    !navigator.geolocation
  ) {
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

export default function TestConcertQueryPage() {
  const [query, setQuery] = useState(
    "chill concert under $60",
  );

  const [queryResult, setQueryResult] =
    useState<ConcertQueryResponse | null>(
      null,
    );

  const [
    ticketmasterResponse,
    setTicketmasterResponse,
  ] = useState<unknown>(null);

  const [queryError, setQueryError] =
    useState<string | null>(null);

  const [
    ticketmasterError,
    setTicketmasterError,
  ] = useState<string | null>(null);

  const [
    isInterpreting,
    setIsInterpreting,
  ] = useState(false);

  const [
    isSearchingTicketmaster,
    setIsSearchingTicketmaster,
  ] = useState(false);

  async function handleInterpret(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const normalizedQuery = query.trim();

    if (!normalizedQuery) {
      setQueryError(
        "Enter a concert search query.",
      );
      return;
    }

    setIsInterpreting(true);
    setQueryError(null);
    setTicketmasterError(null);
    setQueryResult(null);
    setTicketmasterResponse(null);

    try {
      const timeZone =
        Intl.DateTimeFormat()
          .resolvedOptions()
          .timeZone || "UTC";

      async function interpret(
        extra?:
          | { location: DeviceLocation }
          | { geolocationDenied: true },
      ) {
        const { data, error } =
          await supabase.functions.invoke(
            "concert-query",
            {
              body: {
                query: normalizedQuery,
                timeZone,
                ...extra,
              },
            },
          );

        if (error) {
          throw error;
        }

        return data;
      }

      /*
       * The first call carries no location on purpose - a query that names a
       * city needs none. Only when the function says it wants one do we ask
       * the browser and try again.
       */
      let data: unknown;

      try {
        data = await interpret();
      } catch (error) {
        const { message, code } =
          await getFunctionError(error);

        if (code !== "location_required") {
          throw new Error(message);
        }

        const location =
          await requestDeviceLocation();

        /*
         * Permission refused, unsupported, or timed out. Say so on the retry
         * and the function widens to a nationwide search instead of asking
         * again - the alternative is a dead end for anyone who says no.
         */
        data = await interpret(
          location
            ? { location }
            : { geolocationDenied: true },
        ).catch(async (retryError) => {
          throw new Error(
            (await getFunctionError(retryError))
              .message,
          );
        });
      }

      if (
        !data ||
        typeof data !== "object" ||
        !("ticketmasterParams" in data)
      ) {
        throw new Error(
          "Concert query returned an invalid response.",
        );
      }

      setQueryResult(
        data as ConcertQueryResponse,
      );
    } catch (error) {
      setQueryError(
        error instanceof Error
          ? error.message
          : "Concert query failed.",
      );
    } finally {
      setIsInterpreting(false);
    }
  }

  async function handleTicketmasterSearch() {
    if (!queryResult) {
      return;
    }

    setIsSearchingTicketmaster(true);
    setTicketmasterError(null);
    setTicketmasterResponse(null);

    try {
      const url = buildConcertsUrl(
        queryResult.ticketmasterParams,
        queryResult.filters,
      );

      const response = await fetch(url);

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : `Ticketmaster request failed (${response.status})`,
        );
      }

      setTicketmasterResponse(data);
    } catch (error) {
      setTicketmasterError(
        error instanceof Error
          ? error.message
          : "Ticketmaster request failed.",
      );
    } finally {
      setIsSearchingTicketmaster(false);
    }
  }

  const ticketmasterUrl = queryResult
    ? buildConcertsUrl(
        queryResult.ticketmasterParams,
        queryResult.filters,
      )
    : null;

  const locationSource =
    queryResult?.meta?.locationSource;

  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-bold">
        GPT Concert Query Test
      </h1>

      <p className="mt-2 text-sm text-gray-600">
        Convert a natural-language query into
        Ticketmaster-compatible parameters, then
        optionally run the search through JamSpot.
        Any query that names no place -
        &ldquo;chill concert under $60&rdquo;,
        &ldquo;Radiohead tickets&rdquo; - asks for
        this device&rsquo;s location and searches
        around it, or searches nationwide if you
        decline.
      </p>

      <form
        onSubmit={handleInterpret}
        className="mt-8 flex gap-3"
      >
        <input
          type="text"
          value={query}
          onChange={(event) =>
            setQuery(event.target.value)
          }
          placeholder="e.g. punk shows in Los Angeles next Friday"
          className="flex-1 rounded border px-3 py-2"
        />

        <button
          type="submit"
          disabled={isInterpreting}
          className="rounded border px-4 py-2 disabled:opacity-50"
        >
          {isInterpreting
            ? "Interpreting..."
            : "Ask Luna"}
        </button>
      </form>

      {queryError && (
        <section className="mt-8">
          <h2 className="font-semibold">
            Concert query error
          </h2>

          <pre className="mt-2 whitespace-pre-wrap rounded border p-4 text-sm">
            {queryError}
          </pre>
        </section>
      )}

      {queryResult && (
        <>
          <section className="mt-8">
            <h2 className="text-lg font-semibold">
              Original query
            </h2>

            <pre className="mt-2 whitespace-pre-wrap rounded border p-4 text-sm">
              {queryResult.query}
            </pre>

            {queryResult.interpretation && (
              <p className="mt-2 text-sm text-gray-600">
                {queryResult.interpretation}
              </p>
            )}
          </section>

          <section className="mt-8">
            <h2 className="text-lg font-semibold">
              Ticketmaster parameters
            </h2>

            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded border p-4 text-sm">
              {JSON.stringify(
                queryResult.ticketmasterParams,
                null,
                2,
              )}
            </pre>
          </section>

          {queryResult.filters && (
            <section className="mt-8">
              <h2 className="text-lg font-semibold">
                Price filter
              </h2>

              <p className="mt-2 text-sm text-gray-600">
                Ticketmaster cannot filter on price,
                so JamSpot applies this to the events
                it gets back.
              </p>

              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded border p-4 text-sm">
                {JSON.stringify(
                  queryResult.filters,
                  null,
                  2,
                )}
              </pre>
            </section>
          )}

          <section className="mt-8">
            <h2 className="text-lg font-semibold">
              Location
            </h2>

            <p className="mt-2 text-sm">
              {locationSource
                ? LOCATION_SOURCE_LABELS[
                  locationSource
                ]
                : "No location information was returned."}
            </p>
          </section>

          {queryResult.meta && (
            <section className="mt-8">
              <h2 className="text-lg font-semibold">
                Edge Function metadata
              </h2>

              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded border p-4 text-sm">
                {JSON.stringify(
                  queryResult.meta,
                  null,
                  2,
                )}
              </pre>
            </section>
          )}

          <section className="mt-8">
            <h2 className="text-lg font-semibold">
              JamSpot Ticketmaster request
            </h2>

            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded border p-4 text-sm">
              {ticketmasterUrl}
            </pre>

            <button
              type="button"
              onClick={
                handleTicketmasterSearch
              }
              disabled={
                isSearchingTicketmaster
              }
              className="mt-4 rounded border px-4 py-2 disabled:opacity-50"
            >
              {isSearchingTicketmaster
                ? "Searching Ticketmaster..."
                : "Run Ticketmaster Search"}
            </button>
          </section>
        </>
      )}

      {ticketmasterError && (
        <section className="mt-8">
          <h2 className="font-semibold">
            Ticketmaster error
          </h2>

          <pre className="mt-2 whitespace-pre-wrap rounded border p-4 text-sm">
            {ticketmasterError}
          </pre>
        </section>
      )}

      {ticketmasterResponse !== null && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">
            Ticketmaster response
          </h2>

          <pre className="mt-2 max-h-[800px] overflow-auto whitespace-pre-wrap rounded border p-4 text-sm">
            {JSON.stringify(
              ticketmasterResponse,
              null,
              2,
            )}
          </pre>
        </section>
      )}
    </main>
  );
}
